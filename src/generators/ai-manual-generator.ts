import type { SoftwareManual, ManualGenerationRequest, ManualGenerationResponse, ManualSection, ManualStep, ManualFeature, ManualShortcut, ManualTip, ManualFaq } from '../types/manual.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt-templates.js';
import { formatManualToMarkdown } from './markdown-formatter.js';

export async function generateManual(request: ManualGenerationRequest): Promise<ManualGenerationResponse> {
  const language = request.language ?? 'th';
  const transcript = request.rawTranscript ?? '';
  const apiKey = request.apiKey ?? process.env.GEMINI_API_KEY;

  if (!transcript || transcript.trim().length === 0) {
    return {
      success: false,
      error: 'Transcript content is required.'
    };
  }

  // If Gemini API Key is available, use Gemini AI
  if (apiKey && apiKey.trim().length > 0) {
    try {
      const manual = await callGeminiApi(transcript, apiKey.trim(), language, request.youtubeUrl);
      const markdown = formatManualToMarkdown(manual);
      return {
        success: true,
        manual,
        markdown,
        transcriptItemCount: transcript.split('\n').length
      };
    } catch (err) {
      console.warn('Gemini API call failed, falling back to local deterministic synthesis:', err);
    }
  }

  // Deterministic local synthesis fallback
  const localManual = synthesizeLocalManual(transcript, request.youtubeUrl ?? '', language);
  const markdown = formatManualToMarkdown(localManual);

  return {
    success: true,
    manual: localManual,
    markdown,
    transcriptItemCount: transcript.split('\n').length
  };
}

async function callGeminiApi(
  transcript: string,
  apiKey: string,
  language: 'th' | 'en',
  sourceUrl?: string
): Promise<SoftwareManual> {
  const systemPrompt = buildSystemPrompt(language);
  const userPrompt = buildUserPrompt(transcript, undefined, language);

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
  }

  const jsonResult = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const textOutput = jsonResult.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOutput) {
    throw new Error('Gemini API returned an empty response.');
  }

  const cleanJson = textOutput.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
  const parsed = JSON.parse(cleanJson) as Record<string, unknown>;

  return sanitizeToSoftwareManual(parsed, sourceUrl ?? '', language);
}

function sanitizeToSoftwareManual(raw: Record<string, unknown>, sourceUrl: string, language: 'th' | 'en'): SoftwareManual {
  const isThai = language === 'th';

  const title = typeof raw['title'] === 'string' ? raw['title'] : (isThai ? 'คู่มือการใช้งานโปรแกรม' : 'Software User Manual');
  const programName = typeof raw['programName'] === 'string' ? raw['programName'] : 'Software Tool';
  const targetAudience = typeof raw['targetAudience'] === 'string' ? raw['targetAudience'] : (isThai ? 'ผู้พัฒนาและผู้ใช้งานทั่วไป' : 'Developers & General Users');
  const overview = typeof raw['overview'] === 'string' ? raw['overview'] : '';

  const coreCapabilities = Array.isArray(raw['coreCapabilities'])
    ? raw['coreCapabilities'].filter((item): item is string => typeof item === 'string')
    : [];

  const prerequisites = Array.isArray(raw['prerequisites'])
    ? raw['prerequisites'].filter((item): item is string => typeof item === 'string')
    : [];

  const rawFeatures = Array.isArray(raw['features']) ? raw['features'] : [];
  const features: ManualFeature[] = rawFeatures.map((f: unknown) => {
    const obj = (typeof f === 'object' && f !== null ? f : {}) as Record<string, unknown>;
    return {
      name: typeof obj['name'] === 'string' ? obj['name'] : 'Feature',
      description: typeof obj['description'] === 'string' ? obj['description'] : '',
      purpose: typeof obj['purpose'] === 'string' ? obj['purpose'] : '',
      isAdvanced: Boolean(obj['isAdvanced'])
    };
  });

  const rawGuide = Array.isArray(raw['stepByStepGuide']) ? raw['stepByStepGuide'] : [];
  const stepByStepGuide: ManualSection[] = rawGuide.map((s: unknown, sIdx: number) => {
    const sec = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
    const sectionName = typeof sec['sectionName'] === 'string' ? sec['sectionName'] : `Section ${sIdx + 1}`;
    const rawSteps = Array.isArray(sec['steps']) ? sec['steps'] : [];

    const steps: ManualStep[] = rawSteps.map((st: unknown, idx: number) => {
      const stepObj = (typeof st === 'object' && st !== null ? st : {}) as Record<string, unknown>;
      const actionRaw = typeof stepObj['actionType'] === 'string' ? stepObj['actionType'] : 'general';
      const actionType = isValidActionType(actionRaw) ? actionRaw : 'general';

      return {
        stepNumber: typeof stepObj['stepNumber'] === 'number' ? stepObj['stepNumber'] : idx + 1,
        title: typeof stepObj['title'] === 'string' ? stepObj['title'] : `Step ${idx + 1}`,
        description: typeof stepObj['description'] === 'string' ? stepObj['description'] : '',
        timestamp: typeof stepObj['timestamp'] === 'string' ? stepObj['timestamp'] : undefined,
        actionType,
        codeSnippet: typeof stepObj['codeSnippet'] === 'string' ? stepObj['codeSnippet'] : undefined
      };
    });

    return { sectionName, steps };
  });

  const rawShortcuts = Array.isArray(raw['shortcutsAndConfigs']) ? raw['shortcutsAndConfigs'] : [];
  const shortcutsAndConfigs: ManualShortcut[] = rawShortcuts.map((sc: unknown) => {
    const obj = (typeof sc === 'object' && sc !== null ? sc : {}) as Record<string, unknown>;
    return {
      key: typeof obj['key'] === 'string' ? obj['key'] : '',
      action: typeof obj['action'] === 'string' ? obj['action'] : '',
      context: typeof obj['context'] === 'string' ? obj['context'] : undefined
    };
  });

  const rawTips = Array.isArray(raw['tipsAndWarnings']) ? raw['tipsAndWarnings'] : [];
  const tipsAndWarnings: ManualTip[] = rawTips.map((t: unknown) => {
    const obj = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
    const typeRaw = typeof obj['type'] === 'string' ? obj['type'] : 'tip';
    const tipType = typeRaw === 'warning' || typeRaw === 'gotcha' ? typeRaw : 'tip';
    return {
      type: tipType,
      message: typeof obj['message'] === 'string' ? obj['message'] : ''
    };
  });

  const rawFaq = Array.isArray(raw['faq']) ? raw['faq'] : [];
  const faq: ManualFaq[] = rawFaq.map((q: unknown) => {
    const obj = (typeof q === 'object' && q !== null ? q : {}) as Record<string, unknown>;
    return {
      question: typeof obj['question'] === 'string' ? obj['question'] : '',
      answer: typeof obj['answer'] === 'string' ? obj['answer'] : ''
    };
  });

  return {
    title,
    programName,
    targetAudience,
    overview,
    coreCapabilities,
    features,
    prerequisites,
    stepByStepGuide,
    shortcutsAndConfigs,
    tipsAndWarnings,
    faq,
    sourceVideoUrl: sourceUrl,
    generatedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    language
  };
}

function isValidActionType(val: string): val is ManualStep['actionType'] {
  return ['click', 'input', 'navigate', 'configure', 'export', 'general'].includes(val);
}

function synthesizeLocalManual(transcript: string, sourceUrl: string, language: 'th' | 'en'): SoftwareManual {
  const isThai = language === 'th';
  const lines = transcript.split('\n').filter((l) => l.trim().length > 0);

  // Group lines into timestamps and clean text
  const timestampItems: Array<{ time: string; text: string }> = [];
  const timeRegex = /\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.*)/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match?.[1] && match[2]) {
      timestampItems.push({ time: match[1], text: match[2].trim() });
    } else {
      timestampItems.push({ time: '', text: line.trim() });
    }
  }

  // Extract key terms
  const allText = timestampItems.map((item) => item.text).join(' ');
  const codeMatches = Array.from(allText.matchAll(/`([^`]+)`/g)).map((m) => m[1] ?? '');
  const commandMatches = Array.from(allText.matchAll(/(?:npm|npx|git|pnpm|yarn|docker|cargo|python)\s+[a-zA-Z0-9_\-.:/]+/g)).map(
    (m) => m[0]
  );

  const steps: ManualStep[] = [];
  let stepCounter = 1;

  // Segment items into steps every few timestamps
  const chunkSize = Math.max(3, Math.floor(timestampItems.length / 5));
  for (let i = 0; i < timestampItems.length; i += chunkSize) {
    const chunk = timestampItems.slice(i, i + chunkSize);
    const firstItem = chunk[0];
    const chunkText = chunk.map((c) => c.text).join('. ');
    if (chunkText.length > 0 && firstItem) {
      steps.push({
        stepNumber: stepCounter++,
        title: isThai ? `ขั้นตอนการดำเนินงานช่วงที่ ${stepCounter - 1}` : `Operation Phase ${stepCounter - 1}`,
        description: chunkText.slice(0, 300) + (chunkText.length > 300 ? '...' : ''),
        timestamp: firstItem.time.length > 0 ? firstItem.time : undefined,
        actionType: determineActionType(chunkText)
      });
    }
  }

  const commandsList = Array.from(new Set([...codeMatches, ...commandMatches]));

  return {
    title: isThai ? 'คู่มือการทำงานของโปรแกรม (สกัดจากคลิปวิดีโอ)' : 'Software User Manual & Procedure Guide',
    programName: isThai ? 'โปรแกรมตามวิดีโอสาธิต' : 'Software Program from Tutorial',
    targetAudience: isThai ? 'ผู้ใช้งานทั่วไป และนักพัฒนาที่ต้องการทบทวนขั้นตอน' : 'Users & Developers',
    overview: isThai
      ? 'คู่มือนี้ถูกสังเคราะห์และรวบรวมจากวิดีโอสาธิตการใช้งาน เพื่อให้ผู้ใช้สามารถติดตามขั้นตอนและฟังก์ชันทั้งหมดได้อย่างเป็นระบบ'
      : 'This user manual is systematically extracted from the tutorial transcript to provide clear, actionable steps.',
    coreCapabilities: isThai
      ? [
          'สกัดขั้นตอนการใช้งานโปรแกรมอย่างเป็นลำดับ 1-2-3',
          'สรุปคำสั่งและคีย์ลัดที่ผู้สอนใช้งานจริง',
          'มี Timestamp อ้างอิงกลับไปยังคลิปวิดีโอต้นทาง'
        ]
      : [
          'Extract structured step-by-step workflow 1-2-3',
          'Summarize actual commands and shortcuts demonstrated',
          'Provides video timestamp references'
        ],
    features: [
      {
        name: isThai ? 'ระบบประมวลผลคำสั่งตามคลิป' : 'Workflow Execution Engine',
        description: isThai ? 'ทำงานตามขั้นตอนที่แสดงในวิดีโอสาธิต' : 'Executes actions demonstrated in video',
        purpose: isThai ? 'ช่วยให้ใช้งานฟังก์ชันได้ครบถ้วน' : 'Ensures full feature coverage'
      }
    ],
    prerequisites: isThai
      ? ['ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต', 'ติดตั้งเครื่องมือหรือ Dependencies ที่จำเป็น']
      : ['Internet connection', 'Required dependencies'],
    stepByStepGuide: [
      {
        sectionName: isThai ? 'กระบวนการทำงานหลัก (Main Workflow)' : 'Main Workflow',
        steps: steps.length > 0 ? steps : [
          {
            stepNumber: 1,
            title: isThai ? 'เริ่มต้นใช้งาน' : 'Getting Started',
            description: isThai ? 'เปิดโปรแกรมและเตรียมข้อมูลนำเข้า' : 'Launch application and prepare inputs',
            actionType: 'general'
          }
        ]
      }
    ],
    shortcutsAndConfigs: commandsList.slice(0, 5).map((cmd) => ({
      key: cmd,
      action: isThai ? 'คำสั่งที่ปรากฏในคลิป' : 'Command mentioned in video',
      context: isThai ? 'ใช้งานผ่าน Terminal / Shell' : 'Run in Terminal'
    })),
    tipsAndWarnings: [
      {
        type: 'tip',
        message: isThai
          ? 'หากต้องการผลลัพธ์ที่สมบูรณ์แบบสูงสุดและมีรายละเอียดเชิงลึก สามารถกรอก Gemini API Key ในช่องตั้งค่าได้ครับ'
          : 'For maximum depth and synthesized details, provide a Gemini API Key in settings.'
      }
    ],
    faq: [
      {
        question: isThai ? 'จะกดดูคลิปช่วงเวลานั้นๆ อย่างไร?' : 'How to navigate to specific timestamps?',
        answer: isThai
          ? 'สามารถคลิกที่ปุ่ม Timestamp เช่น [02:15] เพื่อเปิดวิดีโอตรงช่วงเวลานั้นได้ทันที'
          : 'Click the timestamp badge to open YouTube at that exact moment.'
      }
    ],
    sourceVideoUrl: sourceUrl,
    generatedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    language
  };
}

function determineActionType(text: string): ManualStep['actionType'] {
  const lower = text.toLowerCase();
  if (lower.includes('click') || lower.includes('กด') || lower.includes('เลือก')) return 'click';
  if (lower.includes('type') || lower.includes('พิมพ์') || lower.includes('ใส่') || lower.includes('write')) return 'input';
  if (lower.includes('open') || lower.includes('ไปที่') || lower.includes('navigate') || lower.includes('เว็บ')) return 'navigate';
  if (lower.includes('config') || lower.includes('ตั้งค่า') || lower.includes('setup') || lower.includes('setting')) return 'configure';
  if (lower.includes('export') || lower.includes('save') || lower.includes('บันทึก') || lower.includes('ดาวน์โหลด')) return 'export';
  return 'general';
}
