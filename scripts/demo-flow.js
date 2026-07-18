#!/usr/bin/env node
/**
 * End-to-end stub demo without a browser:
 * selection → Glean variants → apply
 *
 * Requires companion running: npm run companion
 */
const BASE = (process.env.VIZCOPY_COMPANION_URL || 'http://127.0.0.1:3344').replace(
  /\/$/,
  ''
);

async function main() {
  const selection = {
    origin: 'http://localhost:3000',
    pageUrl: 'http://localhost:3000/demo',
    selector: 'div#hero',
    tagName: 'div',
    nodes: [
      { path: '0', role: 'heading', text: 'Utilize our robust platform today' },
      { path: '1', role: 'text', text: 'Seamless fleet insights for every operator.' },
      { path: '2', role: 'action', text: 'Get started' }
    ],
    combinedText:
      'Utilize our robust platform today\nSeamless fleet insights for every operator.\nGet started'
  };

  console.log('1) POST /api/selection');
  let res = await fetch(`${BASE}/api/selection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selection)
  });
  let data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || 'selection failed');
  }
  const sessionId = data.session.id;
  console.log('   session', sessionId);

  console.log('2) POST /api/variants (Glean stub)');
  res = await fetch(`${BASE}/api/variants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  });
  data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || 'variants failed');
  }
  console.log(
    '   variants:',
    data.variants.map((v) => v.id + ' — ' + v.label).join('\n            ')
  );

  const pick = data.variants[0];
  console.log('3) POST /api/apply →', pick.id);
  res = await fetch(`${BASE}/api/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, variantId: pick.id })
  });
  data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || 'apply failed');
  }
  console.log('   applied nodes:');
  for (const n of data.variant.nodes) {
    console.log('    ', n.path, '→', n.text);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('Demo failed:', err.message);
  console.error('Is the companion running? npm run companion');
  process.exit(1);
});
