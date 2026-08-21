import assert from 'node:assert';
import { parseYouTubeUrl, formatTimestamp } from './extractors/youtube-url.js';
import { parseVttOrSrt, parseTimedTextXml } from './extractors/transcript-extractor.js';
import { generateManual } from './generators/ai-manual-generator.js';
import { formatManualToMarkdown } from './generators/markdown-formatter.js';
import type { SoftwareManual } from './types/manual.js';

let passedTests = 0;
let failedTests = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(() => {
          console.log(`  ✅ PASS: ${name}`);
          passedTests++;
        })
        .catch((err) => {
          console.error(`  ❌ FAIL: ${name}`);
          console.error(err);
          failedTests++;
        });
    } else {
      console.log(`  ✅ PASS: ${name}`);
      passedTests++;
    }
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    failedTests++;
  }
}

async function main() {
  console.log('🧪 Starting Automated Test Suite for ClipToManual...\n');

  // Test 1: parseYouTubeUrl
  runTest('parseYouTubeUrl should parse standard watch URLs and timestamps', () => {
    const res1 = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s');
    assert.strictEqual(res1.isValid, true);
    assert.strictEqual(res1.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(res1.startSeconds, 90);

    const res2 = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=45');
    assert.strictEqual(res2.isValid, true);
    assert.strictEqual(res2.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(res2.startSeconds, 45);

    const res3 = parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    assert.strictEqual(res3.isValid, true);
    assert.strictEqual(res3.isShort, true);
  });

  // Test 2: formatTimestamp
  runTest('formatTimestamp should format seconds to MM:SS and HH:MM:SS', () => {
    assert.strictEqual(formatTimestamp(75), '01:15');
    assert.strictEqual(formatTimestamp(3665), '01:01:05');
    assert.strictEqual(formatTimestamp(0), '00:00');
  });

  // Test 3: parseVttOrSrt
  runTest('parseVttOrSrt should correctly parse WebVTT format', () => {
    const sampleVtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Welcome to the software tutorial.

2
00:00:05.500 --> 00:00:09.200
Click the export button to save your file.
`;
    const segments = parseVttOrSrt(sampleVtt);
    assert.strictEqual(segments.length, 2);
    assert.strictEqual(segments[0]?.start, 1);
    assert.strictEqual(segments[0]?.text, 'Welcome to the software tutorial.');
    assert.strictEqual(segments[1]?.formattedTime, '00:05');
  });

  // Test 4: parseTimedTextXml
  runTest('parseTimedTextXml should parse YouTube TimedText XML', () => {
    const xml = `<transcript>
      <text start="2.4" dur="3.1">Hello and welcome</text>
      <text start="5.5" dur="2.0">Run &quot;npm install&quot; first</text>
    </transcript>`;
    const segments = parseTimedTextXml(xml);
    assert.strictEqual(segments.length, 2);
    assert.strictEqual(segments[0]?.text, 'Hello and welcome');
    assert.strictEqual(segments[1]?.text, 'Run "npm install" first');
  });

  // Test 5: generateManual local synthesis fallback
  await (async () => {
    try {
      const sampleTranscript = `[00:01] Welcome to Pinterest Media Studio
[00:05] Click on single pin downloader tab
[00:15] Paste the URL and click extract button
[00:30] Use hotkey Ctrl+C to copy colors`;

      const res = await generateManual({
        rawTranscript: sampleTranscript,
        language: 'th'
      });

      assert.strictEqual(res.success, true);
      assert.ok(res.manual);
      assert.ok(res.markdown && res.markdown.length > 50);
      console.log('  ✅ PASS: generateManual local deterministic synthesis');
      passedTests++;
    } catch (err) {
      console.error('  ❌ FAIL: generateManual local deterministic synthesis', err);
      failedTests++;
    }
  })();

  // Test 6: formatManualToMarkdown
  runTest('formatManualToMarkdown should render all sections', () => {
    const manual: SoftwareManual = {
      title: 'Test Software Manual',
      programName: 'TestApp',
      targetAudience: 'Engineers',
      overview: 'Test overview description',
      coreCapabilities: ['Cap 1', 'Cap 2'],
      features: [{ name: 'Feat 1', description: 'Desc 1', purpose: 'Purp 1' }],
      prerequisites: ['Node.js 20+'],
      stepByStepGuide: [
        {
          sectionName: 'Getting Started',
          steps: [
            {
              stepNumber: 1,
              title: 'Install dependencies',
              description: 'Run npm install',
              actionType: 'input',
              codeSnippet: 'npm install'
            }
          ]
        }
      ],
      shortcutsAndConfigs: [{ key: 'Ctrl+S', action: 'Save', context: 'Editor' }],
      tipsAndWarnings: [{ type: 'tip', message: 'Always test first' }],
      faq: [{ question: 'Is it free?', answer: 'Yes' }],
      sourceVideoUrl: 'https://www.youtube.com/watch?v=123',
      generatedAt: '2026-08-21 00:00:00',
      language: 'en'
    };

    const md = formatManualToMarkdown(manual);
    assert.ok(md.includes('# 📖 Test Software Manual'));
    assert.ok(md.includes('`TestApp`'));
    assert.ok(md.includes('Step 1: Install dependencies'));
    assert.ok(md.includes('> [!TIP]'));
  });

  // Test 7: isYtDlpAvailable
  await (async () => {
    try {
      const { isYtDlpAvailable } = await import('./extractors/yt-dlp-extractor.js');
      const available = await isYtDlpAvailable();
      console.log(`  ℹ️  yt-dlp availability on system: ${available}`);
      assert.strictEqual(typeof available, 'boolean');
      console.log('  ✅ PASS: isYtDlpAvailable checked successfully');
      passedTests++;
    } catch (err) {
      console.error('  ❌ FAIL: isYtDlpAvailable test', err);
      failedTests++;
    }
  })();

  console.log(`\n================================`);
  console.log(`  Tests Passed: ${passedTests}`);
  console.log(`  Tests Failed: ${failedTests}`);
  console.log(`================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
