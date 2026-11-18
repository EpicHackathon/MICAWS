import { unzipSync, strFromU8 } from 'fflate';

export const materialLimits = { fileBytes: 10 * 1024 * 1024, pages: 50, characters: 30000, files: 3, totalCharacters: 60000 };
const abort = signal => { if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError'); };
const clean = text => text.replace(/\s+/g, ' ').trim();

function parseXml(xml) {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('Document XML contains an unsupported declaration.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('PowerPoint contains invalid XML.');
  return document;
}

export function extractPptxPages(bytes) {
  let expandedBytes = 0;
  let slideCount = 0;
  const files = unzipSync(bytes, { filter(file) {
    const slide = /^ppt\/slides\/slide\d+\.xml$/.test(file.name);
    if (!slide && !['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'].includes(file.name)) return false;
    expandedBytes += file.originalSize;
    if (file.originalSize > 2 * 1024 * 1024 || expandedBytes > 8 * 1024 * 1024) {
      throw new Error('PowerPoint expanded content is too large. Upload a smaller presentation.');
    }
    if (slide && ++slideCount > materialLimits.pages) throw new Error('Use presentations with at most 50 slides.');
    return true;
  } });
  if (!files['ppt/presentation.xml'] || !files['ppt/_rels/presentation.xml.rels']) {
    throw new Error('This file is not a readable PPTX presentation. Export older .ppt files to .pptx first.');
  }
  const presentation = parseXml(strFromU8(files['ppt/presentation.xml']));
  const relationships = parseXml(strFromU8(files['ppt/_rels/presentation.xml.rels']));
  const targets = new Map([...relationships.getElementsByTagName('Relationship')]
    .filter(element => element.getAttribute('TargetMode') !== 'External')
    .map(element => [element.getAttribute('Id'), element.getAttribute('Target')]));
  return [...presentation.getElementsByTagNameNS('*', 'sldId')].map((slide, index) => {
    const id = slide.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = targets.get(id);
    const path = target?.startsWith('/ppt/') ? target.slice(1) : 'ppt/' + target?.replace(/^\.\//, '');
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(path) || !files[path]) throw new Error('PowerPoint has a missing or unsupported slide reference.');
    const xml = parseXml(strFromU8(files[path]));
    const text = [...xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't')]
      .map(element => element.textContent).join(' ');
    return { page: index + 1, text: clean(text) };
  });
}

async function loadPdfLibrary() {
  const [pdf, worker] = await Promise.all([
    import('pdfjs-dist/build/pdf.mjs'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdf.GlobalWorkerOptions.workerSrc = worker.default;
  return pdf;
}

export async function extractPdfPages(bytes, { signal, onProgress = () => {}, loadPdf = loadPdfLibrary } = {}) {
  const pdf = await loadPdf();
  abort(signal);
  const task = pdf.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true });
  const cancel = () => { void task.destroy(); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const document = await task.promise;
    if (document.numPages > materialLimits.pages) throw new Error('Use PDFs with at most 50 pages.');
    const pages = [];
    let characters = 0;
    for (let index = 1; index <= document.numPages; index++) {
      abort(signal);
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const text = clean(content.items.filter(item => typeof item.str === 'string').map(item => item.str).join(' '));
      page.cleanup();
      characters += text.length;
      if (characters > materialLimits.characters) throw new Error('Document text exceeds 30,000 characters. Upload an excerpt.');
      pages.push({ page: index, text });
      onProgress(`Reading PDF page ${index} of ${document.numPages}…`);
    }
    abort(signal);
    return pages;
  } catch (cause) {
    abort(signal);
    if (cause.name === 'PasswordException') throw new Error('Password-protected PDFs are not supported. Upload an unlocked copy.');
    throw cause;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await task.destroy();
  }
}

export async function extractMeetingMaterial(file, options = {}) {
  const { signal, onProgress = () => {} } = options;
  abort(signal);
  if (!file || file.size === 0) throw new Error('Choose a nonempty file.');
  if (file.size > materialLimits.fileBytes) throw new Error('Each file must be 10 MB or smaller.');
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (!['pdf', 'pptx', 'txt'].includes(extension)) throw new Error('Supported formats: PDF, PPTX and UTF-8 TXT. Export other formats first.');
  onProgress(`Reading ${file.name}…`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  abort(signal);
  let pages;
  if (extension === 'pdf') {
    if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('The selected file is not a PDF.');
    pages = await extractPdfPages(bytes, options);
  } else if (extension === 'pptx') pages = extractPptxPages(bytes);
  else {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('Save text files as UTF-8 before uploading.'); }
    if (text.includes('\0')) throw new Error('This looks like binary data rather than a text file.');
    pages = [{ page: 1, text: clean(text) }];
  }
  abort(signal);
  const readable = pages.filter(page => page.text);
  if (!readable.length) throw new Error('No readable text found. Scanned PDFs and image-only slides need OCR or a text export first.');
  if (readable.reduce((sum, page) => sum + page.text.length, 0) > materialLimits.characters) throw new Error('Document text exceeds 30,000 characters. Upload an excerpt.');
  return {
    material: { id: crypto.randomUUID(), name: file.name.slice(0, 200), pages: readable },
    warning: readable.length < pages.length ? `${pages.length - readable.length} page(s) or slide(s) contain no readable text and were skipped. Images, charts and speaker notes are not extracted.` : null,
  };
}

export function addMeetingMaterial(materials, material, replaceId) {
  const next = replaceId ? materials.map(item => item.id === replaceId ? material : item) : [...materials, material];
  if (replaceId && !materials.some(item => item.id === replaceId)) throw new Error('The material was removed before replacement finished.');
  if (next.length > materialLimits.files) throw new Error('Keep at most 3 supporting materials. Remove one before adding another.');
  if (next.reduce((sum, item) => sum + item.pages.reduce((total, page) => total + page.text.length, 0), 0) > materialLimits.totalCharacters) {
    throw new Error('Combined material text exceeds 60,000 characters. Use shorter excerpts.');
  }
  return next;
}
