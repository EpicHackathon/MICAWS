import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { zipSync, strToU8 } from 'fflate';
import { addMeetingMaterial, extractMeetingMaterial, extractPdfPages, materialLimits } from '../src/services/meetingMaterials.js';

const file = (name, value) => new File([value], name);
const xml = (body, namespace = 'http://schemas.openxmlformats.org/presentationml/2006/main') => `<?xml version="1.0"?><p:root xmlns:p="${namespace}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}</p:root>`;
function presentation(text = 'Launch plan') {
  return zipSync({
    'ppt/presentation.xml': strToU8(xml('<p:sldIdLst><p:sldId r:id="last"/><p:sldId r:id="first"/></p:sldIdLst>')),
    'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="last" Target="slides/slide9.xml"/><Relationship Id="first" Target="slides/slide1.xml"/></Relationships>'),
    'ppt/slides/slide9.xml': strToU8(xml(`<a:t>${text}</a:t>`)),
    'ppt/slides/slide1.xml': strToU8(xml('<a:t>Budget &amp; timeline</a:t>')),
  });
}

test('text material preserves content and checks format, size, encoding and text limits', async () => {
  const { material } = await extractMeetingMaterial(file('agenda.txt', 'Budget\n  review'));
  assert.equal(material.name, 'agenda.txt');
  assert.deepEqual(material.pages, [{ page: 1, text: 'Budget review' }]);
  await assert.rejects(extractMeetingMaterial(file('agenda.docx', 'text')), /Supported formats/);
  await assert.rejects(extractMeetingMaterial(file('empty.txt', '')), /nonempty/);
  await assert.rejects(extractMeetingMaterial(file('binary.txt', new Uint8Array([255, 255]))), /UTF-8/);
  await assert.rejects(extractMeetingMaterial(file('binary.txt', '\0data')), /binary/);
  await assert.rejects(extractMeetingMaterial(file('long.txt', 'x'.repeat(materialLimits.characters + 1))), /30,000/);
  await assert.rejects(extractMeetingMaterial({ name: 'large.pdf', size: materialLimits.fileBytes + 1 }), /10 MB/);
});

test('PPTX follows presentation order and extracts escaped text with slide references', async t => {
  const dom = new JSDOM();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  Object.defineProperty(globalThis, 'DOMParser', { value: dom.window.DOMParser, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'DOMParser', previous);
    else delete globalThis.DOMParser;
    dom.window.close();
  });
  const { material } = await extractMeetingMaterial(file('slides.pptx', presentation()));
  assert.deepEqual(material.pages, [{ page: 1, text: 'Launch plan' }, { page: 2, text: 'Budget & timeline' }]);
  const partial = await extractMeetingMaterial(file('slides.pptx', presentation('')));
  assert.match(partial.warning, /1 page/);
  assert.equal(partial.material.pages[0].page, 2);
});

test('PPTX refuses oversized expanded XML before decompression', async () => {
  const data = zipSync({ 'ppt/slides/slide1.xml': strToU8('x'.repeat(2 * 1024 * 1024 + 1)) });
  await assert.rejects(extractMeetingMaterial(file('compressed.pptx', data)), /expanded content/);
});

function tinyPdf() {
  const stream = 'BT /F1 12 Tf 72 720 Td (Budget approved.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(text.length); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return text;
}

test('real PDF parser extracts a page of text', async () => {
  const { material } = await extractMeetingMaterial(file('budget.pdf', tinyPdf()), {
    loadPdf: () => import('pdfjs-dist/legacy/build/pdf.mjs'),
  });
  assert.deepEqual(material.pages, [{ page: 1, text: 'Budget approved.' }]);
});

test('PDF empty/image-only text reports OCR requirement and releases the parser', async () => {
  let destroyed = 0;
  const loadPdf = async () => ({ getDocument: () => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [] }), cleanup() {} }) }),
    destroy: async () => { destroyed++; },
  }) });
  await assert.rejects(extractMeetingMaterial(file('scan.pdf', '%PDF-1.4'), { loadPdf }), /OCR/);
  assert.equal(destroyed, 1);
});

test('cancel during PDF extraction does not return stale content and cleans up', async () => {
  const controller = new AbortController();
  let destroyed = 0;
  const loadPdf = async () => ({ getDocument: () => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'Text' }] }), cleanup() {} }) }),
    destroy: async () => { destroyed++; },
  }) });
  await assert.rejects(extractPdfPages(new Uint8Array(), {
    signal: controller.signal, loadPdf, onProgress: () => controller.abort(),
  }), { name: 'AbortError' });
  assert.ok(destroyed >= 1);
});

test('replacement removes old context and refuses stale or oversized additions', () => {
  const old = { id: 'old', name: 'old.txt', pages: [{ page: 1, text: 'Old agenda' }] };
  const next = { id: 'new', name: 'new.txt', pages: [{ page: 1, text: 'New agenda' }] };
  assert.deepEqual(addMeetingMaterial([old], next, 'old'), [next]);
  assert.throws(() => addMeetingMaterial([], next, 'old'), /removed/);
  assert.throws(() => addMeetingMaterial([old, old, old], next), /at most 3/);
  assert.throws(() => addMeetingMaterial([{ ...old, pages: [{ page: 1, text: 'x'.repeat(60000) }] }], next), /60,000/);
});
