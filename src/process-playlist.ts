import { getPlaylistVideos } from './extractors/playlist-processor.js';
import { extractWithYtDlp } from './extractors/yt-dlp-extractor.js';
import { generateManual } from './generators/ai-manual-generator.js';
import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const playlistUrl = 'https://www.youtube.com/playlist?list=PL2iz8KGLwG61zO0Q4peV-oWK1Y0ovTe-B';
  console.log('====================================================');
  console.log('  📦 กำลังดึงรายชื่อคลิปทั้งหมดใน Playlist (8 ตอน)...');
  console.log('====================================================');

  const videos = await getPlaylistVideos(playlistUrl);
  console.log(`พบทั้งหมด ${videos.length} วิดีโอใน Playlist:\n`);

  videos.forEach((v) => {
    console.log(`  ${v.index}. ${v.title} [${v.id}]`);
  });

  const manualsDir = path.join(process.cwd(), 'manuals');
  await fs.mkdir(manualsDir, { recursive: true });

  const allManualSections: string[] = [];
  allManualSections.push('# 📖 KruBank Farm Studio - คู่มือการใช้งานฉบับสมบูรณ์ (Master Manual)');
  allManualSections.push('\n> **รวบรวมจากคอร์ส Playlist ครบทั้ง 8 ตอน**');
  allManualSections.push(`> **เพลย์ลิสต์ต้นทาง:** [YouTube Playlist](${playlistUrl})\n---\n`);

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    if (!video) continue;

    console.log(`\n----------------------------------------------------`);
    console.log(`[${i + 1}/${videos.length}] กำลังประมวลผล: ${video.title} ...`);

    const extResult = await extractWithYtDlp(video.url);
    if (!extResult.success || extResult.segments.length === 0) {
      console.warn(`⚠️ ตอนที่ ${video.index} (${video.title}) ดึงซับไม่ได้: ${extResult.error}`);
      continue;
    }

    console.log(`  ✅ ดึงซับสำเร็จ (${extResult.segments.length} รายการเวลา) -> กำลังสังเคราะห์คู่มือ...`);

    const genResult = await generateManual({
      youtubeUrl: video.url,
      rawTranscript: extResult.fullText,
      language: 'th'
    });

    if (genResult.success && genResult.markdown) {
      // Save individual EP manual
      const singleFileName = `EP${video.index}_${video.id}_Manual.md`;
      await fs.writeFile(path.join(manualsDir, singleFileName), genResult.markdown, 'utf-8');
      console.log(`  💾 บันทึกคู่มือตอนที่ ${video.index} -> ${singleFileName}`);

      allManualSections.push(`\n## 🎬 ตอนที่ ${video.index}: ${video.title}`);
      allManualSections.push(`🔗 ลิงก์วิดีโอ: [ดูคลิป](${video.url})\n`);
      allManualSections.push(genResult.markdown.replace(/^#\s*.+/m, '').trim());
      allManualSections.push('\n---\n');
    }

    // Delay between videos to avoid rate-limiting
    if (i < videos.length - 1) {
      await new Promise((res) => setTimeout(res, 2000));
    }
  }

  // Save Master Manual
  const masterPath = path.join(manualsDir, 'KruBank_Farm_Studio_Complete_Master_Manual.md');
  await fs.writeFile(masterPath, allManualSections.join('\n'), 'utf-8');

  console.log('\n====================================================');
  console.log(`🎉 สร้างคู่มือ Master Manual ครบทุกตอนเรียบร้อย!`);
  console.log(`📁 ไฟล์คู่มือรวม: ${masterPath}`);
  console.log('====================================================');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
