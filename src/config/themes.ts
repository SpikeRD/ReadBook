// 阅读主题（背景与配色）。新增主题只需往 themes 里加一项。
// 页面头部内联加载当前主题，避免刷新时闪白/闪黑。

export interface Theme {
  id: string;
  name: string;
  /** 色板：与 global.css 的 CSS 变量一一对应 */
  colors: {
    bg: string;
    card: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentSoft: string;
    danger: string;
    /** 「已掌握」类高亮的底色 */
    knownBg: string;
  };
  /** 浏览器地址栏颜色 */
  metaThemeColor: string;
  /** 深色主题：原生控件、滚动条使用暗色 */
  dark?: boolean;
}

export const themes: Theme[] = [
  {
    id: 'day',
    name: '白天',
    colors: {
      bg: '#f5f6f8',
      card: '#ffffff',
      text: '#1f2430',
      muted: '#6b7280',
      border: '#e5e7eb',
      accent: '#3b6ef6',
      accentSoft: '#eaf0ff',
      danger: '#d64545',
      knownBg: '#e8f7ee',
    },
    metaThemeColor: '#ffffff',
  },
  {
    id: 'night',
    name: '黑夜',
    dark: true,
    colors: {
      bg: '#14161c',
      card: '#1c1f27',
      text: '#e6e8ee',
      muted: '#9aa3b2',
      border: '#2b303b',
      accent: '#6f97ff',
      accentSoft: '#232b42',
      danger: '#ff8080',
      knownBg: '#1f3a2c',
    },
    metaThemeColor: '#14161c',
  },
  {
    id: 'eye',
    name: '护眼（豆沙绿）',
    colors: {
      bg: '#e6f0e1',
      card: '#f3f8ef',
      text: '#25331f',
      muted: '#5f6f57',
      border: '#cfdcc6',
      accent: '#3f7d4a',
      accentSoft: '#d8e9d0',
      danger: '#b3452f',
      knownBg: '#cde6c2',
    },
    metaThemeColor: '#e6f0e1',
  },
  {
    id: 'sepia',
    name: '暖黄（纸张）',
    colors: {
      bg: '#f3e9d7',
      card: '#fbf4e6',
      text: '#3a2f21',
      muted: '#7d6b52',
      border: '#e2d3ba',
      accent: '#a2672c',
      accentSoft: '#efe0c7',
      danger: '#a8402c',
      knownBg: '#e4eccf',
    },
    metaThemeColor: '#f3e9d7',
  },
  {
    id: 'contrast',
    name: '高对比',
    colors: {
      bg: '#ffffff',
      card: '#ffffff',
      text: '#000000',
      muted: '#333333',
      border: '#000000',
      accent: '#0b3bb5',
      accentSoft: '#e3e9ff',
      danger: '#b00020',
      knownBg: '#dff2e2',
    },
    metaThemeColor: '#ffffff',
  },
];

export const DEFAULT_THEME = 'day';
export const THEME_STORAGE_KEY = 'readbook.theme';

export function getTheme(id: string | null | undefined): Theme {
  return themes.find((t) => t.id === id) ?? themes.find((t) => t.id === DEFAULT_THEME)!;
}

/** 生成注入到 <head> 的全局 CSS 变量 */
export function themeCss(theme: Theme): string {
  return `:root{${Object.entries(themeVars(theme))
    .map(([k, v]) => `${k}:${v}`)
    .join(';')};color-scheme:${theme.dark ? 'dark' : 'light'}}`;
}

/** 把主题色展开成全部 CSS 变量（含由主色派生的浅色块，深色主题才不会出现白斑） */
export function themeVars(theme: Theme): Record<string, string> {
  const c = theme.colors;
  const dark = !!theme.dark;
  return {
    '--bg': c.bg,
    '--card': c.card,
    '--text': c.text,
    '--muted': c.muted,
    '--border': c.border,
    '--accent': c.accent,
    '--accent-soft': c.accentSoft,
    '--danger': c.danger,
    '--known-bg': c.knownBg,
    // 派生色
    '--surface-soft': c.accentSoft,
    '--surface-hover': c.muted,
    '--word-active': dark ? '#3a3416' : '#fff1c9',
    '--word-new': dark ? '#4a3a1c' : '#ffe7bf',
    '--known-line': dark ? '#3f7f5c' : '#8fd1ab',
    '--zh-text': dark ? c.text : '#4b5563',
    '--zh-heading': dark ? c.text : '#374151',
    '--error-bg': dark ? '#3a1f22' : '#fff5f5',
    '--error-border': dark ? '#6b3038' : '#f3cccc',
    '--ok-bg': dark ? '#16291f' : '#f1fbf5',
    '--ok-border': dark ? '#2c5138' : '#bfe7cf',
    '--on-accent': dark ? c.bg : '#ffffff',
  };
}

/**
 * 在首帧渲染前应用主题：读取 localStorage，缺省用 DEFAULT_THEME。
 * 以字符串形式内联，避免一次额外请求造成闪烁。
 */
export function themeBootScript(): string {
  const map = Object.fromEntries(themes.map((t) => [t.id, themeVars(t)]));
  const darkIds = themes.filter((t) => t.dark).map((t) => t.id);
  return `(function(){try{var KEY='${THEME_STORAGE_KEY}';var MAP=${JSON.stringify(map)};var DARK=${JSON.stringify(darkIds)};var id=localStorage.getItem(KEY)||'${DEFAULT_THEME}';var vars=MAP[id]||MAP['${DEFAULT_THEME}'];var s=document.documentElement.style;for(var k in vars){s.setProperty(k,vars[k]);}document.documentElement.dataset.theme=MAP[id]?id:'${DEFAULT_THEME}';s.colorScheme=DARK.indexOf(id)>=0?'dark':'light';}catch(e){}})();`;
}
