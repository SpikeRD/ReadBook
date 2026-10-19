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

/** 为新用户创建欢迎文章（失败不影响注册流程） */
export async function seedWelcomeArticle(userId: string): Promise<boolean> {
  try {
    const { createArticle } = await import('./articles.ts');
    const result = await createArticle(userId, { title: SAMPLE_ARTICLE_TITLE, text: SAMPLE_ARTICLE_TEXT });
    return !!result.ok;
  } catch (err) {
    console.warn('[seed] 欢迎文章创建失败', err);
    return false;
  }
}
