// Unit tests for the pure parts of the operations tool:  node --test scripts/staging/stack.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProxyArgs, CDN_IPS_VENDORED, cdnProblems, loadParsPackCdnIpListText, parseAddressRanges, writeVendoredCdnIpList } from './stack.mjs';
import { readFileSync } from 'node:fs';

test('parseAddressRanges accepts addresses and ranges, ignores blanks, comments and duplicates', () => {
  const text = '185.208.173.0/24\r\n\n# note\n2.144.23.191/32  # one host\n2.144.23.191/32\n89.187.169.11\n2001:db8::/48\n';
  assert.deepEqual(parseAddressRanges(text), ['185.208.173.0/24', '2.144.23.191/32', '89.187.169.11', '2001:db8::/48']);
});

test('parseAddressRanges refuses anything that is not an address or range', () => {
  for (const bad of ['example.com', '999.1.1.1/24', '10.0.0.0/33', '10.0.0.0/24/1', '10.0.0.0/abc', '<html>', '1.2.3.4 5.6.7.8']) {
    assert.throws(() => parseAddressRanges(bad), /Not an address/, bad);
  }
});

test('parseAddressRanges refuses ranges so wide that "trusted" would mean everybody', () => {
  for (const wide of ['0.0.0.0/0', '10.0.0.0/8', '1.2.0.0/15', '::/0', '2001::/16']) {
    assert.throws(() => parseAddressRanges(wide), /too wide/, wide);
  }
  assert.deepEqual(parseAddressRanges('1.2.0.0/16'), ['1.2.0.0/16']);
});

test('parseAddressRanges refuses an implausibly long list', () => {
  const many = Array.from({ length: 600 }, (_, i) => `10.${Math.floor(i / 250)}.${i % 250}.0/24`).join('\n');
  assert.throws(() => parseAddressRanges(many), /not a CDN list/);
});

test('cdnProblems: a CDN setting without trusted ranges is refused', () => {
  assert.equal(cdnProblems({ CONGRESS_SITE_ADDRESS: 'x.example' }).length, 0);
  assert.match(cdnProblems({ CONGRESS_CDN: 'on', CONGRESS_SITE_ADDRESS: 'x.example' }).join(), /TRUSTED_PROXIES is empty/);
  assert.match(cdnProblems({ CONGRESS_CDN_ONLY: 'on', CONGRESS_TRUSTED_PROXIES: '1.2.3.0/24', CONGRESS_SITE_ADDRESS: 'x.example' }).join(), /needs CONGRESS_CDN=on/);
  assert.equal(cdnProblems({ CONGRESS_CDN: 'on', CONGRESS_TRUSTED_PROXIES: '1.2.3.0/24', CONGRESS_SITE_ADDRESS: 'x.example' }).length, 0);
});

test('cdnProblems: the origin protocol and the site address must agree', () => {
  assert.match(cdnProblems({ CONGRESS_ORIGIN_TLS: 'off', CONGRESS_SITE_ADDRESS: 'x.example' }).join(), /start with http:\/\//);
  assert.match(cdnProblems({ CONGRESS_SITE_ADDRESS: 'http://x.example' }).join(), /cdn origin https/);
  assert.equal(cdnProblems({ CONGRESS_ORIGIN_TLS: 'off', CONGRESS_SITE_ADDRESS: 'http://x.example' }).length, 0);
  // Local staging's address list must keep working.
  assert.equal(cdnProblems({ CONGRESS_SITE_ADDRESS: 'https://localhost, https://172.16.1.7' }).length, 0);
});

test('vendored ParsPack list loads offline', async () => {
  const { text, source } = await loadParsPackCdnIpListText({ offline: true });
  assert.equal(source, 'vendored');
  assert.ok(parseAddressRanges(text).length >= 40);
  assert.equal(readFileSync(CDN_IPS_VENDORED, 'utf8').trim(), writeVendoredCdnIpList(text).join('\n'));
});

test('buildProxyArgs is empty without a proxy and sets both spellings with one', () => {
  assert.deepEqual(buildProxyArgs({}), []);
  const args = buildProxyArgs({ CONGRESS_BUILD_PROXY: 'http://172.17.0.1:8118', CONGRESS_BUILD_NO_PROXY: 'localhost' });
  assert.ok(args.includes('HTTPS_PROXY=http://172.17.0.1:8118') && args.includes('https_proxy=http://172.17.0.1:8118') && args.includes('no_proxy=localhost'));
});
