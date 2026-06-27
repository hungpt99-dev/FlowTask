import type { UseCaseType, UseCaseDetection, UseCaseConfig } from "./usecase-types.js";

interface UseCasePattern {
  type: UseCaseType;
  patterns: RegExp[];
}

const USE_CASE_ORDER: UseCaseType[] = [
  "data-analysis",
  "ui-design",
  "writing",
  "devops",
  "testing",
  "project-setup",
  "planning",
  "research",
  "debugging",
  "documentation",
  "coding",
  "general",
];

const DEFAULT_PATTERNS: UseCasePattern[] = [
  {
    type: "coding",
    patterns: [
      /implement\b/i,
      /build\b/i,
      /develop\b/i,
      /\badd\s+(feature|functionality|module|api|endpoint)/i,
      /\bcreate\s+(module|function|class|component|service|controller)/i,
      /\brefactor\b/i,
      /\bwrite\s+code\b/i,
      /\bfeature\b/i,
      /\bmodule\b/i,
      /\bfunction\b/i,
      /\bclass\b/i,
      /\bapi\s+endpoint\b/i,
      /\bfrontend\b/i,
      /\bbackend\b/i,
    ],
  },
  {
    type: "documentation",
    patterns: [
      /\bdocument(ation)?\b/i,
      /\breadme\b/i,
      /\buser\s+guide\b/i,
      /\bapi\s+docs?\b/i,
      /\brelease\s+notes\b/i,
      /\bsetup\s+instructions\b/i,
      /\bchangelog\b/i,
      /\bwiki\b/i,
      /\bmanual\b/i,
      /\btechnical\s+writing\b/i,
      /\bdoc\s+string/i,
    ],
  },
  {
    type: "debugging",
    patterns: [
      /\bbug\b/i,
      /\bfix\b/i,
      /\berror\b/i,
      /\bcrash\b/i,
      /\b(issue|problem)\b/i,
      /\bbroken\b/i,
      /\bfailing\b/i,
      /\bdebug\b/i,
      /\btroubleshoot\b/i,
      /\broot\s+cause\b/i,
      /\bnot\s+working\b/i,
    ],
  },
  {
    type: "research",
    patterns: [
      /\bresearch\b/i,
      /\binvestigate\b/i,
      /\bcompare\b/i,
      /\bevaluate\b/i,
      /\bexplore\b/i,
      /\bstudy\b/i,
      /\blook\s+into\b/i,
      /\banalyze\s+options\b/i,
      /\bwhat\s+is\b/i,
      /\bhow\s+does\b/i,
    ],
  },
  {
    type: "planning",
    patterns: [
      /\bplan\b/i,
      /\bdesign\b/i,
      /\barchitect(ure)?\b/i,
      /\boutline\b/i,
      /\bstrategy\b/i,
      /\broadmap\b/i,
      /\bbreak\s+down\b/i,
      /\bmilestone\b/i,
      /\bsprint\b/i,
    ],
  },
  {
    type: "project-setup",
    patterns: [
      /\binit(ialize)?\b/i,
      /\bset\s*up\b/i,
      /\bconfigure\b/i,
      /\bscaffold\b/i,
      /\bboilerplate\b/i,
      /\bproject\s+structure\b/i,
      /\bnew\s+project\b/i,
      /\bcreate\s+repo(sitory)?\b/i,
    ],
  },
  {
    type: "testing",
    patterns: [
      /\btest(s|ing)?\b/i,
      /\bspec\b/i,
      /\bcoverag(e|ing)\b/i,
      /\bunit\s+test\b/i,
      /\bintegration\s+test\b/i,
      /\be2e\b/i,
      /\btest\s+cases?\b/i,
    ],
  },
  {
    type: "devops",
    patterns: [
      /\bdeploy\b/i,
      /\bci\/cd\b/i,
      /\bpipeline\b/i,
      /\bdocker\b/i,
      /\bkubernetes\b/i,
      /\binfrastructure\b/i,
      /\bterraform\b/i,
      /\brelease\b/i,
      /\bdevops\b/i,
    ],
  },
  {
    type: "data-analysis",
    patterns: [
      /\banalyze\s+(the\s+)?data\b/i,
      /\bdata\s+analysis\b/i,
      /\bstatistics?\b/i,
      /\bvisuali(s|z)ation(s)?\b/i,
      /\bchart(s)?\b/i,
      /\bdataset(s)?\b/i,
      /\bpandas\b/i,
      /\bdata\s+science\b/i,
      /\bregression\b/i,
      /\bcorrelation\b/i,
      /\bstatistical\s+(test|analysis|model)/i,
      /\bdata\s+(processing|cleaning|transformation|mining)/i,
      /\bmachine\s+learning\b/i,
      /\b(extract|transform|load)\s+(data|information)/i,
    ],
  },
  {
    type: "ui-design",
    patterns: [
      /\bui\b/i,
      /\bux\b/i,
      /\binterface\b/i,
      /\blayout\b/i,
      /\bstyle\b/i,
      /\btheme\b/i,
      /\bcomponent\s+(library|design)\b/i,
      /\btailwind\b/i,
      /\bcss\b/i,
      /\bresponsive\b/i,
      /\bdesign\s+system\b/i,
    ],
  },
  {
    type: "writing",
    patterns: [
      /\bwrite\s+(a\s+|an\s+|the\s+)?(content|article|blog|post|email|report|story|guide)/i,
      /\bcontent\s+creation\b/i,
      /\bmarketing\s+copy\b/i,
      /\bedit\s+(content|document|text|article|post)/i,
      /\bprose\b/i,
      /\bblog\s+post\b/i,
      /\bnewsletter\b/i,
      /\bsocial\s+media\s+(post|content|caption)/i,
      /\blanding\s+page\s+copy\b/i,
      /\bproduct\s+description\b/i,
      /\bemail\s+(campaign|draft|template)/i,
      /\bcopywriting\b/i,
      /\bscript\s+(for|writing)/i,
      /\bcreative\s+writing\b/i,
      /\bghostwrite\b/i,
      /\bwhite\s+paper\b/i,
      /\be?mail\s+newsletter\b/i,
    ],
  },
];

export class UseCaseDetector {
  private config: UseCaseConfig;
  private patterns: UseCasePattern[];

  constructor(config?: UseCaseConfig) {
    this.config = config ?? { enabled: true, customPatterns: [], confidenceThreshold: 0.3 };
    this.patterns = this.buildPatterns();
  }

  detect(prompt: string): UseCaseDetection {
    if (!this.config.enabled || !prompt.trim()) {
      return { type: "general", confidence: 0, matchedPatterns: [] };
    }

    const matches: { type: UseCaseType; count: number; matched: string[] }[] = [];

    for (const group of this.patterns) {
      const matched: string[] = [];
      for (const regex of group.patterns) {
        const found = prompt.match(regex);
        if (found) {
          matched.push(found[0]);
        }
      }
      if (matched.length > 0) {
        matches.push({ type: group.type, count: matched.length, matched });
      }
    }

    if (matches.length === 0) {
      return { type: "general", confidence: 0, matchedPatterns: [] };
    }

    matches.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return USE_CASE_ORDER.indexOf(a.type) - USE_CASE_ORDER.indexOf(b.type);
    });

    const topMatch = matches[0]!;
    const totalPatterns = matches.reduce((sum, m) => sum + m.count, 0);
    const confidence = Math.min(topMatch.count / Math.max(totalPatterns, 1) + 0.1, 1);

    const threshold = this.config.confidenceThreshold;
    if (confidence < threshold) {
      return { type: "general", confidence: 0, matchedPatterns: [] };
    }

    return {
      type: topMatch.type,
      confidence,
      matchedPatterns: topMatch.matched,
    };
  }

  getUseCaseHint(useCase: UseCaseType): string {
    const hints: Record<UseCaseType, string> = {
      coding:
        "This is a coding task. Focus on generating code, following language conventions, and ensuring type safety.",
      documentation:
        "This is a documentation task. Focus on clarity, completeness, and structure. Avoid writing code unless explicitly required.",
      debugging:
        "This is a debugging task. Focus on understanding the error, finding root cause, and applying targeted fixes without unrelated changes.",
      research:
        "This is a research task. Do not invent facts. Separate facts from assumptions. Track sources and provide evidence.",
      planning:
        "This is a planning task. Focus on analysis, structure, and documentation. Do not implement — create a plan for execution.",
      "project-setup":
        "This is a project setup task. Focus on scaffolding, configuration, and tooling setup.",
      testing:
        "This is a testing task. Focus on test coverage, edge cases, and verifying correctness. Do not modify production code unnecessarily.",
      devops:
        "This is a DevOps task. Focus on infrastructure, automation, and deployment configuration.",
      "data-analysis":
        "This is a data analysis task. Focus on data processing, statistics, and clear visualizations.",
      "ui-design":
        "This is a UI/UX task. Focus on design systems, accessibility, responsiveness, and user experience.",
      writing:
        "This is a writing task. Focus on clear prose, structure, and readability. Avoid code unless explicitly needed.",
      general:
        "This is a general AI task. Adapt to the specific request with appropriate tools and approaches.",
    };
    return hints[useCase] ?? hints.general;
  }

  private buildPatterns(): UseCasePattern[] {
    const patterns = [...DEFAULT_PATTERNS];

    if (this.config.customPatterns) {
      for (const custom of this.config.customPatterns) {
        const existing = patterns.find((p) => p.type === custom.type);
        const regexPatterns = custom.patterns.map((p) => new RegExp(p, "i"));
        if (existing) {
          existing.patterns.push(...regexPatterns);
        } else {
          patterns.push({ type: custom.type, patterns: regexPatterns });
        }
      }
    }

    return patterns;
  }
}
