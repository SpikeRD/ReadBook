// 新账号的欢迎文章：每个用户注册后自动导入一篇，保证首屏不是空白。
// 与服务端 lib 共用同一份文本，避免两处文案漂移。

export const SAMPLE_ARTICLE_TITLE = 'The Quiet Power of Reading Every Day（示例文章）';

export const SAMPLE_ARTICLE_TEXT = `
# The Quiet Power of Reading Every Day

Reading is a simple habit, but the effect is not small. A few pages every morning can change how you think, how you speak, and how you see the world. The key is not speed. The key is to keep going, even on days when you feel tired.

When you meet a word you do not know, do not skip it. Point at it, look at the meaning, and listen to the sound. Then write it down. Your vocabulary will grow step by step, and every new word opens a door to a new idea.

The best time to read is the time you actually have. Some people read on the bus. Others read before they sleep. Choose a place and a time that belong to you alone, and protect that moment. A small habit, repeated, becomes a strong system.

Do not worry about understanding everything at the first try. Read the sentence again, look up one key word, and move on. Memory likes repetition and interest, not pressure. If a page feels hard today, come back to it next week.

Language is a tool for ideas. The more you read, the more ideas you can carry, and the easier it becomes to express your own thoughts in English and in Chinese. Start with one page today, and let the habit do the rest.
`;

/* ───────────── 中文示例文章（中文阅读，纯阅读） ───────────── */

export const SAMPLE_ZH_ARTICLE_TITLE = '慢读的力气（中文示例）';

export const SAMPLE_ZH_ARTICLE_TEXT = `
# 慢读的力气

读书这件事，快并不一定是好事。一页一页地读，遇到不懂的地方停下来想一想，反而记得更牢。速度带来的是数量，停顿带来的是理解。

# 遇到生字怎么办

中文阅读里没有查词按钮，也不需要。遇到不认识的字，先看上下文，往往能猜出大意；实在猜不出，再去查。这个"先猜后查"的顺序，比边读边查更接近真实的阅读。

# 每天读一点

把阅读放在固定的时间：通勤的地铁上、睡前的二十分钟、午饭后的一小段空档。时间不必长，但要是自己的。日子久了，读过的字会连成线，线会连成面。

# 不必读完

有些书翻几页就够了，有些书要读很多遍。读不下去的时候合上，不必勉强。读书是工具，不是任务；它服务于你，而不是相反。
`;

/** 为新用户创建欢迎文章（失败不影响注册流程） */
export async function seedWelcomeArticle(userId: string): Promise<boolean> {
  try {
    const { createArticle } = await import('./articles.ts');
    const en = await createArticle(userId, { title: SAMPLE_ARTICLE_TITLE, text: SAMPLE_ARTICLE_TEXT });
    // 中文阅读是独立的第二套列表，也给一篇示例，避免 /zh 首屏空白
    const zh = await createArticle(userId, { title: SAMPLE_ZH_ARTICLE_TITLE, text: SAMPLE_ZH_ARTICLE_TEXT, lang: 'zh' });
    return !!en.ok || !!zh.ok;
  } catch (err) {
    console.warn('[seed] 欢迎文章创建失败', err);
    return false;
  }
}
