export interface TranscriptSegment {
  readonly start: number;
  readonly duration: number;
  readonly text: string;
  readonly formattedTime: string;
}

export interface VideoMetadata {
  readonly videoId: string;
  readonly title: string;
  readonly author?: string;
  readonly lengthSeconds?: number;
  readonly thumbnailUrl?: string;
}

export interface ManualStep {
  readonly stepNumber: number;
  readonly title: string;
  readonly description: string;
  readonly timestamp?: string;
  readonly actionType: 'click' | 'input' | 'navigate' | 'configure' | 'export' | 'general';
  readonly codeSnippet?: string;
}

export interface ManualSection {
  readonly sectionName: string;
  readonly steps: readonly ManualStep[];
}

export interface ManualFeature {
  readonly name: string;
  readonly description: string;
  readonly purpose: string;
  readonly isAdvanced?: boolean;
}

export interface ManualShortcut {
  readonly key: string;
  readonly action: string;
  readonly context?: string;
}

export interface ManualTip {
  readonly type: 'warning' | 'tip' | 'gotcha';
  readonly message: string;
}

export interface ManualFaq {
  readonly question: string;
  readonly answer: string;
}

export interface SoftwareManual {
  readonly title: string;
  readonly programName: string;
  readonly targetAudience: string;
  readonly overview: string;
  readonly coreCapabilities: readonly string[];
  readonly features: readonly ManualFeature[];
  readonly prerequisites: readonly string[];
  readonly stepByStepGuide: readonly ManualSection[];
  readonly shortcutsAndConfigs: readonly ManualShortcut[];
  readonly tipsAndWarnings: readonly ManualTip[];
  readonly faq: readonly ManualFaq[];
  readonly sourceVideoUrl: string;
  readonly generatedAt: string;
  readonly language: 'th' | 'en';
}

export interface ManualGenerationRequest {
  readonly youtubeUrl?: string;
  readonly rawTranscript?: string;
  readonly language?: 'th' | 'en';
  readonly apiKey?: string;
}

export interface ManualGenerationResponse {
  readonly success: boolean;
  readonly manual?: SoftwareManual;
  readonly markdown?: string;
  readonly error?: string;
  readonly transcriptItemCount?: number;
}
