import type { SoftwareManual } from '../types/manual.js';

export function formatManualToMarkdown(manual: SoftwareManual): string {
  const isThai = manual.language === 'th';
  const lines: string[] = [];

  // Header
  lines.push(`# 📖 ${manual.title}`);
  lines.push('');
  lines.push(`> **${isThai ? 'โปรแกรม / เครื่องมือ' : 'Software / Tool'}:** \`${manual.programName}\`  `);
  lines.push(`> **${isThai ? 'กลุ่มเป้าหมาย' : 'Target Audience'}:** ${manual.targetAudience}  `);
  if (manual.sourceVideoUrl) {
    lines.push(`> **${isThai ? 'วิดีโอต้นฉบับ' : 'Source Video'}:** [${manual.sourceVideoUrl}](${manual.sourceVideoUrl})  `);
  }
  lines.push(`> **${isThai ? 'สร้างเมื่อ' : 'Generated At'}:** ${manual.generatedAt}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 1. Overview
  lines.push(`## 📌 1. ${isThai ? 'ภาพรวมและวัตถุประสงค์ (Overview)' : 'Overview & Purpose'}`);
  lines.push('');
  lines.push(manual.overview);
  lines.push('');

  if (manual.coreCapabilities.length > 0) {
    lines.push(`### 🌟 ${isThai ? 'ความสามารถหลัก (Core Capabilities)' : 'Core Capabilities'}`);
    lines.push('');
    for (const cap of manual.coreCapabilities) {
      lines.push(`- ✅ ${cap}`);
    }
    lines.push('');
  }

  // 2. Prerequisites
  if (manual.prerequisites.length > 0) {
    lines.push(`## 🛠️ 2. ${isThai ? 'สิ่งที่ต้องเตรียมก่อนใช้งาน (Prerequisites)' : 'Prerequisites & Requirements'}`);
    lines.push('');
    for (const req of manual.prerequisites) {
      lines.push(`- 🔹 ${req}`);
    }
    lines.push('');
  }

  // 3. Feature Breakdown
  if (manual.features.length > 0) {
    lines.push(`## 🧩 3. ${isThai ? 'รายการฟีเจอร์และการทำงาน (Feature Breakdown)' : 'Feature Breakdown'}`);
    lines.push('');
    lines.push(`| ${isThai ? 'ชื่อฟีเจอร์' : 'Feature'} | ${isThai ? 'รายละเอียดการทำงาน' : 'Description'} | ${isThai ? 'ประโยชน์ / หน้าที่' : 'Purpose'} |`);
    lines.push('|---|---|---|');
    for (const feat of manual.features) {
      const tag = feat.isAdvanced ? ' *(Advanced)*' : '';
      const name = `${escapeMarkdown(feat.name)}${tag}`;
      const desc = escapeMarkdown(feat.description);
      const purpose = escapeMarkdown(feat.purpose);
      lines.push(`| **${name}** | ${desc} | ${purpose} |`);
    }
    lines.push('');
  }

  // 4. Step-by-Step Workflow
  if (manual.stepByStepGuide.length > 0) {
    lines.push(`## 🚀 4. ${isThai ? 'ขั้นตอนการใช้งานทีละ Step (Step-by-Step Guide)' : 'Step-by-Step User Guide'}`);
    lines.push('');

    for (const section of manual.stepByStepGuide) {
      lines.push(`### 📂 ${section.sectionName}`);
      lines.push('');

      for (const step of section.steps) {
        let timeBadge = '';
        if (step.timestamp) {
          if (manual.sourceVideoUrl) {
            const timeSec = parseTimestampToSeconds(step.timestamp);
            const link = makeYouTubeTimeLink(manual.sourceVideoUrl, timeSec);
            timeBadge = ` ⏱️ [${step.timestamp}](${link})`;
          } else {
            timeBadge = ` ⏱️ \`${step.timestamp}\``;
          }
        }

        const actionIcon = getActionIcon(step.actionType);
        lines.push(`#### Step ${step.stepNumber}: ${step.title}${timeBadge}`);
        lines.push('');
        lines.push(`${actionIcon} **${isThai ? 'การกระทำ' : 'Action'}:** ${step.description}`);
        lines.push('');

        if (step.codeSnippet) {
          lines.push('```bash');
          lines.push(step.codeSnippet);
          lines.push('```');
          lines.push('');
        }
      }
    }
  }

  // 5. Shortcuts & Configs
  if (manual.shortcutsAndConfigs.length > 0) {
    lines.push(`## ⌨️ 5. ${isThai ? 'คีย์ลัดและการตั้งค่าสำคัญ (Shortcuts & Configurations)' : 'Shortcuts & Configurations'}`);
    lines.push('');
    lines.push(`| ${isThai ? 'คีย์ลัด / ตัวแปร' : 'Key / Setting'} | ${isThai ? 'คำสั่ง / หน้าที่' : 'Action'} | ${isThai ? 'บริบทการใช้งาน' : 'Context'} |`);
    lines.push('|---|---|---|');
    for (const sc of manual.shortcutsAndConfigs) {
      lines.push(`| \`${escapeMarkdown(sc.key)}\` | ${escapeMarkdown(sc.action)} | ${escapeMarkdown(sc.context ?? '-')} |`);
    }
    lines.push('');
  }

  // 6. Tips & Warnings
  if (manual.tipsAndWarnings.length > 0) {
    lines.push(`## ⚠️ 6. ${isThai ? 'ข้อควรระวังและเทคนิคพิเศษ (Tips & Warnings)' : 'Tips, Gotchas & Warnings'}`);
    lines.push('');

    for (const item of manual.tipsAndWarnings) {
      if (item.type === 'warning') {
        lines.push('> [!WARNING]');
        lines.push(`> **${isThai ? 'ข้อควรระวัง' : 'Warning'}:** ${item.message}`);
      } else if (item.type === 'gotcha') {
        lines.push('> [!CAUTION]');
        lines.push(`> **${isThai ? 'จุดที่มักพลาด (Gotcha)' : 'Gotcha'}:** ${item.message}`);
      } else {
        lines.push('> [!TIP]');
        lines.push(`> **${isThai ? 'เทคนิคแนะนำ' : 'Tip'}:** ${item.message}`);
      }
      lines.push('');
    }
  }

  // 7. FAQ
  if (manual.faq.length > 0) {
    lines.push(`## ❓ 7. ${isThai ? 'คำถามที่พบบ่อย (FAQ)' : 'Frequently Asked Questions'}`);
    lines.push('');
    for (const q of manual.faq) {
      lines.push(`- **Q: ${q.question}**`);
      lines.push(`  - **A:** ${q.answer}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`*Generated by [ClipToManual](https://github.com/thanonhari/clip-to-manual) - Anti-Slop AI Documentation Generator*`);

  return lines.join('\n');
}

function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function getActionIcon(actionType: string): string {
  switch (actionType) {
    case 'click':
      return '🖱️';
    case 'input':
      return '⌨️';
    case 'navigate':
      return '🧭';
    case 'configure':
      return '⚙️';
    case 'export':
      return '💾';
    default:
      return '👉';
  }
}

function parseTimestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && parts[0] !== undefined && parts[1] !== undefined && parts[2] !== undefined) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function makeYouTubeTimeLink(sourceUrl: string, seconds: number): string {
  try {
    const url = new URL(sourceUrl);
    url.searchParams.set('t', `${seconds}s`);
    return url.toString();
  } catch {
    return `${sourceUrl}&t=${seconds}s`;
  }
}
