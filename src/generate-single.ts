import { extractWithYtDlp } from './extractors/yt-dlp-extractor.js';
import { generateManual } from './generators/ai-manual-generator.js';
import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const url = 'https://www.youtube.com/watch?v=5FdXiL7sX58&list=PL2iz8KGLwG61zO0Q4peV-oWK1Y0ovTe-B';
  console.log('[1/4] กำลังดึงข้อมูลและซับไตเติลด้วย yt-dlp...');

  const extResult = await extractWithYtDlp(url);
  if (!extResult.success || extResult.segments.length === 0) {
    console.error('❌ ดึงซับไตเติลไม่สำเร็จ:', extResult.error);
    process.exit(1);
  }

  console.log(`[2/4] ดึงซับไตเติลสำเร็จ! ทั้งหมด ${extResult.segments.length} รายการเวลา`);
  console.log(`[3/4] กำลังให้ AI สังเคราะห์คู่มือการใช้งานภาษาไทย...`);

  const genResult = await generateManual({
    youtubeUrl: url,
    rawTranscript: extResult.fullText,
    language: 'th'
  });

  if (!genResult.success || !genResult.markdown) {
    console.error('❌ สร้างคู่มือไม่สำเร็จ:', genResult.error);
    process.exit(1);
  }

  const manualsDir = path.join(process.cwd(), 'manuals');
  await fs.mkdir(manualsDir, { recursive: true });
  const fileName = 'KruBank_Farm_Studio_EP1_Manual.md';
  const outPath = path.join(manualsDir, fileName);
  await fs.writeFile(outPath, genResult.markdown, 'utf-8');

  console.log(`[4/4] ✅ สร้างคู่มือและบันทึกไฟล์สำเร็จเรียบร้อย: ${outPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
