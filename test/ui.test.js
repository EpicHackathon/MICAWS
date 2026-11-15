import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createServer } from 'vite';
import { createHandler } from '../api/process.js';

test('typed input, details navigation, view toggle and reset work through the app', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/?dev' });   // ?dev shows the test-text box
  const originals = new Map();
  function expose(key, value) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'SVGElement', 'Node', 'MutationObserver']) {
    expose(key, dom.window[key]);
  }
  expose('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  expose('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  expose('requestAnimationFrame', callback => setTimeout(callback, 0));
  expose('cancelAnimationFrame', clearTimeout);
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  dom.window.confirm = () => true;
  const handler = createHandler({ env: { MEETING_MOCK: 'true' } });
  const requests = [];
  let failNext = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(JSON.parse(options.body));
    if (failNext) {
      failNext = false;
      return Response.json({ error: 'Temporary failure. Retry this batch.' }, { status: 502 });
    }
    return handler(new Request('http://localhost' + url, options));
  });
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
  t.after(() => server.close());
  const { createRoot } = await import('react-dom/client');
  const { default: App } = await server.ssrLoadModule('/src/App.jsx');
  const root = createRoot(document.getElementById('root'));
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  const topicCount = () => Number(document.querySelector('[data-topic-count]')?.dataset.topicCount);
  const click = async text => {
    const target = button(text);
    assert.ok(target, 'Button exists: ' + text);
    await act(async () => target.click());
  };
  try {
    await act(async () => root.render(React.createElement(App)));
    assert.equal(button('Send test text').disabled, true);
    const textarea = document.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(
        textarea, 'We decided to launch next week',
      );
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(button('Send test text').disabled, false);
    await click('Send test text');
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].newSegments, [{ time: 0, speaker: null, text: 'We decided to launch next week' }]);
    for (let attempt = 0; attempt < 100 && !document.querySelector('[role=alert]'); attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    assert.ok(document.querySelector('[role=alert]').textContent.includes('Temporary failure'));
    assert.ok(document.querySelector('[role=alert]').textContent.includes('Retrying automatically'));
    assert.equal(button('Process pending / retry'), undefined);   // no button: it retries by itself
    for (let attempt = 0; attempt < 400 && requests.length < 2; attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    for (let attempt = 0; attempt < 400 && topicCount() !== 2; attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    assert.equal(topicCount(), 2, document.body.textContent);
    // the topic list and its details panel are gone: the mind map is the only view
    assert.equal(button('Show topic list'), undefined);
    assert.equal(document.querySelector('[aria-label="Node details"]'), null);
    assert.ok(document.querySelector('.mindmap'), 'mind map is shown');
    // ?dev is on, so the backup tools are visible
    assert.ok(button('Load sample meeting'));
    assert.ok(button('Send sample batch 1'));
    dom.window.confirm = () => false;
    await click('Reset session');
    assert.equal(topicCount(), 2);
    dom.window.confirm = () => true;
    await click('Reset session');
    assert.ok(document.body.textContent.includes('No topics yet.'));
    assert.equal(document.querySelector('[aria-label="Node details"]'), null);
    assert.equal(document.querySelector('textarea').value, '');
  } finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
