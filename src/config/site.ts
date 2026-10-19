// ─────────────────────────────────────────────────────────────
// 唯一需要你改动的配置文件。
// 站点名、导航、社交账号、关于我、容量限制都在这里，改完重启 dev 即可生效。
// 敏感信息（访问口令、签名密钥）不放这里，见 .env（参考 .env.example）。
// ─────────────────────────────────────────────────────────────

export interface NavItem {
  /** 导航文字 */
  label: string;
  /** 站内路径，如 /vocabulary */
  href: string;
}

export interface SocialLink {
  label: string;
  href: string;
}

export interface ContactLink extends SocialLink {
  /** 显示文字（例如邮箱地址本身） */
  text: string;
}

export const siteConfig = {
  /** 站点名（显示在页头、浏览器标签、口令页） */
  siteName: 'ReadBook 英文阅读站',
  /** 一句话简介（口令页、页脚使用） */
  tagline: '导入英文文章，点词查中文释义，生词自动进本',
  /** 页脚版权名 */
  author: '你的名字',

  /** 顶部导航（顺序即展示顺序；首页与关于我在内） */
  nav: [
    { label: '文章', href: '/' },
    { label: '导入', href: '/import' },
    { label: '生词本', href: '/vocabulary' },
    { label: '关于我', href: '/about' },
  ] satisfies NavItem[],

  /** 「关于我」页面内容 */
  about: {
    title: '关于我',
    /** 开头一段自我介绍 */
    intro:
      '你好，我是一名 RPA 开发工程师，日常工作是用 Python 把重复的流程自动化。' +
      '写这个站点的原因是：读英文技术资料时总被生词打断，市面上的工具要么太重、要么要注册账号。' +
      '于是做了这个轻量的阅读器，把「读」和「记」放在一页里。',
    /** 分段的补充说明 */
    paragraphs: [
      '这里的内容只给自己和几位朋友用，不开放注册，也不做任何追踪统计。',
      '我的生词本存在浏览器本地，随时可以导出 JSON 备份；换设备时导入即可。',
    ],
    /** 联系方式（会显示在下方，href 支持 mailto: / https:） */
    contacts: [
      { label: '邮件', href: 'mailto:you@example.com', text: 'you@example.com' },
      { label: 'GitHub', href: 'https://github.com/your-name', text: 'github.com/your-name' },
    ] satisfies ContactLink[],
    /** 可选头像图，放在 public/ 下；留空则显示占位字母 */
    avatar: '',
  },

  /** 页脚社交链接 */
  footerLinks: [
    { label: '邮件联系', href: 'mailto:you@example.com' },
    { label: 'GitHub', href: 'https://github.com/your-name' },
  ] satisfies SocialLink[],

  /** 站点限制（与需求文档「容量与资源限制」对应） */
  limits: {
    /** 单篇文章上限：1MB */
    maxArticleBytes: 1024 * 1024,
    /** 单个用户的文章正文总量上限 */
    maxUserBytes: 2 * 1024 * 1024 * 1024,
    /** 全部用户文章正文总量上限：2GB */
    maxTotalBytes: 2 * 1024 * 1024 * 1024,
    /** 磁盘剩余空间低于该值时拒绝导入 */
    minFreeDiskBytes: 500 * 1024 * 1024,
    /** 阅读页一次最多高亮的生词数（性能保护） */
    highlightLimit: 500,
  },

  /** 账号体系（用户名 + 密码，数据按用户隔离） */
  auth: {
    /** 是否允许自助注册；关掉后只能由站长在服务器上新增账号 */
    allowRegistration: true,
    /** 站点最多容纳的账号数（个人网站 + 几个朋友） */
    maxUsers: 20,
    minUsernameLength: 2,
    maxUsernameLength: 24,
    /** 密码最短长度 */
    minPasswordLength: 6,
    /** 登录页引导语 */
    loginHint: '用自己的用户名登录，文章和生词本会自动同步到你的账号；换设备登录即可继续。',
  },

  /** 生词本首屏分组展示方式 */
  vocab: {
    /** true：按文章分组；false：按添加时间倒序平铺 */
    groupByArticle: true,
    /** 点词后是否自动加入生词本（true：查过即记录，可撤销；false：只加手动点击的词） */
    autoAddOnLookup: true,
  },

  /** 阅读页默认发音语言 */
  speechLang: 'en-US',

  /** 长文分页：一篇文章按内容切成多页，避免"一本书只有一页" */
  pagination: {
    /** 每页约多少字符（英文约 3000 字符≈500 词；手机端排版约需翻 2-3 屏） */
    charsPerPage: 3000,
  },

  /**
   * 全文翻译（阅读页「全文翻译」按钮）
   * provider:
   *   'tencent'  —— 腾讯交互翻译（默认）：国内直连、免密钥、支持批量、翻译质量好；
   *   'mymemory' —— MyMemory：免费，但单次 500 字符且每天有额度，长文容易 429；
   *   'custom'   —— 使用 .env 里的 ONLINE_TRANSLATE_URL 自定义接口；
   *   'none'     —— 关闭。
   * 译文按「段」增量缓存到 data/users/<用户id>/translations/，翻页、刷新都不会丢。
   */
  translation: {
    provider: 'tencent' as 'tencent' | 'mymemory' | 'custom' | 'none',
    /** 目标语言 */
    targetLang: 'zh-CN',
    /** 源语言 */
    sourceLang: 'en',
    /** 单次请求超时（毫秒） */
    timeoutMs: 30000,
    /** 同时进行的翻译批次数（腾讯接口并发过高会返回 busy） */
    concurrency: 2,
    /** 失败自动重试：最多尝试次数、退避基数与上限（毫秒） */
    retry: {
      maxAttempts: 4,
      baseDelayMs: 700,
      maxDelayMs: 6000,
    },
    /** 阅读时预翻译的页数：进入某页时，自动翻译「当前页 + 后面 4 页」 */
    prefetchPages: 5,
    /** 读到第几页时触发下一批预翻译（默认读到第 3 页就续命后 5 页） */
    prefetchTriggerPage: 3,
    /** 页面上的功能名称 */
    label: '全文翻译',
    /** 译文区的提示文案 */
    disclaimer: '机器翻译，仅供理解参考；点英文单词仍可查词与发音。',
    /** 对照模式下译文字号（相对原文的比例） */
    compareFontScale: 0.92,
  },
} as const;

export type SiteConfig = typeof siteConfig;
