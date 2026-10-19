// 用户与账号：密码用 scrypt 加盐哈希，用户表存 data/users.json。
// 好友站点的量级，JSON 文件足够；写入串行化避免并发覆盖。
//
// 角色：
//   admin  —— 站长。凭据来自 .env（ADMIN_USERNAME / ADMIN_PASSWORD），不写入 users.json；
//             首次用管理员凭据登录时自动在 users.json 里落一条 role=admin 的账号（密码哈希），
//             这样普通用户名密码登录也能识别为管理员。
//   user   —— 普通用户。

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { dataRoot, userDir } from './paths.ts';
import { readEnv } from './env.ts';
import { siteConfig } from '../config/site.ts';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type Role = 'admin' | 'user';

export interface UserRecord {
  id: string;
  username: string;
  /** scrypt$<salt base64>$<hash base64> */
  passwordHash: string;
  /** 角色：admin 为站长 */
  role: Role;
  /** 会话版本：改密码后 +1，旧 Cookie 全部失效 */
  sessionVersion: number;
  createdAt: string;
  lastLoginAt?: string;
}

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

const USERS_FILE = 'users.json';

function usersFile(): string {
  return path.join(dataRoot(), USERS_FILE);
}

let writeQueue: Promise<void> = Promise.resolve();
let cache: UserRecord[] | null = null;

async function loadUsers(force = false): Promise<UserRecord[]> {
  if (cache && !force) return cache;
  const file = usersFile();
  if (!existsSync(file)) {
    cache = [];
    return cache;
  }
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as UserRecord[];
    cache = Array.isArray(raw)
      ? raw
          .filter((u) => u && u.id && u.username && u.passwordHash)
          .map((u) => ({
            ...u,
            role: u.role === 'admin' ? 'admin' : 'user',
            sessionVersion: Number(u.sessionVersion) || 1,
          }))
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function saveUsers(list: UserRecord[]): Promise<void> {
  cache = list;
  writeQueue = writeQueue.then(async () => {
    const file = usersFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
    await fs.rename(tmp, file);
  });
  return writeQueue;
}

/* ───────────── 密码 ───────────── */

const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'base64');
    const expected = Buffer.from(parts[2], 'base64');
    const actual = await scrypt(password, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ───────────── 校验 ───────────── */

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateUsername(name: string): ValidationResult {
  const cfg = siteConfig.auth;
  const value = name.trim();
  if (value.length < cfg.minUsernameLength) return { ok: false, error: `用户名至少 ${cfg.minUsernameLength} 个字符` };
  if (value.length > cfg.maxUsernameLength) return { ok: false, error: `用户名最多 ${cfg.maxUsernameLength} 个字符` };
  if (!/^[\p{L}\p{N}_-]+$/u.test(value)) return { ok: false, error: '用户名只能包含中英文、数字、下划线或短横线' };
  return { ok: true };
}

export function validatePassword(password: string): ValidationResult {
  const min = siteConfig.auth.minPasswordLength;
  if (password.length < min) return { ok: false, error: `密码至少 ${min} 位` };
  if (password.length > 200) return { ok: false, error: '密码过长' };
  return { ok: true };
}

/* ───────────── 查询 ───────────── */

function toPublic(u: UserRecord): PublicUser {
  return { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt };
}

export async function findUserByName(username: string): Promise<UserRecord | null> {
  const name = username.trim().toLowerCase();
  const list = await loadUsers();
  return list.find((u) => u.username.toLowerCase() === name) ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const list = await loadUsers();
  return list.find((u) => u.id === id) ?? null;
}

export async function countUsers(): Promise<number> {
  return (await loadUsers()).length;
}

export async function listUsers(): Promise<PublicUser[]> {
  return (await loadUsers()).map(toPublic);
}

/* ───────────── 管理员 ───────────── */

/** .env 里是否配置了管理员凭据 */
export function hasAdminCredentials(): boolean {
  const env = readEnv();
  return !!env.adminUsername && !!env.adminPassword;
}

function matchesAdminEnv(username: string, password: string): boolean {
  const env = readEnv();
  if (!env.adminUsername || !env.adminPassword) return false;
  const nameOk = username.trim().toLowerCase() === env.adminUsername.toLowerCase();
  // 定长比较避免时间侧信道
  const a = Buffer.from(password);
  const b = Buffer.from(env.adminPassword);
  const passOk = a.length === b.length && timingSafeEqual(a, b);
  return nameOk && passOk;
}

/**
 * 确保管理员账号存在且与 .env 一致：
 *   - .env 里配置了管理员，但 users.json 里没有 → 创建（role=admin，密码用 .env 的）
 *   - .env 里改了密码 → 更新哈希并让旧会话失效
 * 登录、中间件都会在需要时调用，开销很小（有缓存）。
 */
export async function ensureAdminAccount(): Promise<UserRecord | null> {
  const env = readEnv();
  if (!env.adminUsername || !env.adminPassword) return null;
  const list = await loadUsers();
  const existing = list.find((u) => u.username.toLowerCase() === env.adminUsername.toLowerCase());

  if (!existing) {
    const user: UserRecord = {
      id: randomBytes(8).toString('hex'),
      username: env.adminUsername,
      passwordHash: await hashPassword(env.adminPassword),
      role: 'admin',
      sessionVersion: 1,
      createdAt: new Date().toISOString(),
    };
    list.push(user);
    await saveUsers(list);
    return user;
  }

  let changed = false;
  if (existing.role !== 'admin') {
    existing.role = 'admin';
    changed = true;
  }
  // 与 .env 中的密码保持一致：不一致就更新哈希并让旧会话失效
  if (!(await verifyPassword(env.adminPassword, existing.passwordHash))) {
    existing.passwordHash = await hashPassword(env.adminPassword);
    existing.sessionVersion = (existing.sessionVersion || 1) + 1;
    changed = true;
  }
  if (changed) await saveUsers(list);
  return existing;
}

export async function isAdmin(userId: string): Promise<boolean> {
  await ensureAdminAccount();
  const user = await findUserById(userId);
  return user?.role === 'admin';
}

/* ───────────── 注册 / 登录 ───────────── */

export async function registerUser(
  username: string,
  password: string
): Promise<{ ok: boolean; user?: PublicUser; error?: string }> {
  const nameCheck = validateUsername(username);
  if (!nameCheck.ok) return { ok: false, error: nameCheck.error };
  const passCheck = validatePassword(password);
  if (!passCheck.ok) return { ok: false, error: passCheck.error };

  const env = readEnv();
  if (env.adminUsername && username.trim().toLowerCase() === env.adminUsername.toLowerCase()) {
    return { ok: false, error: '这个用户名是管理员专用，请换一个' };
  }

  await ensureAdminAccount();
  const list = await loadUsers();
  if (await findUserByName(username)) return { ok: false, error: '这个用户名已经被使用了' };
  if (list.filter((u) => u.role !== 'admin').length >= siteConfig.auth.maxUsers) {
    return { ok: false, error: '站点用户数已达上限，请联系管理员。' };
  }

  const user: UserRecord = {
    id: randomBytes(8).toString('hex'),
    username: username.trim(),
    passwordHash: await hashPassword(password),
    role: 'user',
    sessionVersion: 1,
    createdAt: new Date().toISOString(),
  };
  list.push(user);
  await saveUsers(list);
  return { ok: true, user: toPublic(user) };
}

export async function authenticate(
  username: string,
  password: string
): Promise<{ ok: boolean; user?: PublicUser; error?: string }> {
  // 管理员凭据以 .env 为准
  if (matchesAdminEnv(username, password)) {
    const admin = await ensureAdminAccount();
    if (admin) {
      admin.lastLoginAt = new Date().toISOString();
      await saveUsers(await loadUsers());
      return { ok: true, user: toPublic(admin) };
    }
  }

  const user = await findUserByName(username);
  // 管理员账号：先让记录与 .env 对齐（.env 改过密码时旧哈希必须立刻失效）
  if (!user || user.role === 'admin') {
    const synced = await ensureAdminAccount();
    if (synced && user && synced.id === user.id) {
      user.passwordHash = synced.passwordHash;
      user.sessionVersion = synced.sessionVersion;
      user.role = synced.role;
    }
  }
  // 用户不存在时也跑一次哈希，避免通过响应时间探测用户名
  if (!user) {
    await hashPassword(password);
    return { ok: false, error: '用户名或密码不正确' };
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return { ok: false, error: '用户名或密码不正确' };
  user.lastLoginAt = new Date().toISOString();
  await saveUsers(await loadUsers());
  return { ok: true, user: toPublic(user) };
}

export async function changePassword(userId: string, oldPassword: string, newPassword: string): Promise<ValidationResult> {
  const list = await loadUsers();
  const user = list.find((u) => u.id === userId);
  if (!user) return { ok: false, error: '用户不存在' };
  const env = readEnv();
  if (user.role === 'admin' && env.adminUsername) {
    return { ok: false, error: '管理员密码请在服务器 .env 文件的 ADMIN_PASSWORD 中修改，修改后自动生效。' };
  }
  if (!(await verifyPassword(oldPassword, user.passwordHash))) return { ok: false, error: '原密码不正确' };
  const check = validatePassword(newPassword);
  if (!check.ok) return check;
  user.passwordHash = await hashPassword(newPassword);
  user.sessionVersion = (user.sessionVersion || 1) + 1;
  await saveUsers(list);
  return { ok: true };
}

/** 会话版本号（用于签名 Cookie，改密码后旧会话失效） */
export async function getSessionVersion(userId: string): Promise<number> {
  const user = await findUserById(userId);
  return user?.sessionVersion || 1;
}

/* ───────────── 管理员操作 ───────────── */

export interface AdminUserView extends PublicUser {
  lastLoginAt?: string;
  /** 文章数、生词数（由调用方填充，便于列表展示） */
  articleCount?: number;
  vocabCount?: number;
  isSelf?: boolean;
}

/** 管理员重置某个用户的密码（生成新密码由页面展示给管理员） */
export async function adminResetPassword(userId: string, newPassword: string): Promise<ValidationResult> {
  const check = validatePassword(newPassword);
  if (!check.ok) return check;
  const list = await loadUsers();
  const user = list.find((u) => u.id === userId);
  if (!user) return { ok: false, error: '用户不存在' };
  if (user.role === 'admin') {
    return { ok: false, error: '管理员密码由 .env 的 ADMIN_PASSWORD 控制，不能在这里重置。' };
  }
  user.passwordHash = await hashPassword(newPassword);
  user.sessionVersion = (user.sessionVersion || 1) + 1;
  await saveUsers(list);
  return { ok: true };
}

/** 生成易读的随机密码（避免易混淆字符） */
export function generatePassword(length = 10): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** 删除用户及其全部数据目录 */
export async function adminDeleteUser(userId: string): Promise<ValidationResult> {
  const list = await loadUsers();
  const user = list.find((u) => u.id === userId);
  if (!user) return { ok: false, error: '用户不存在' };
  if (user.role === 'admin') return { ok: false, error: '不能删除管理员账号。' };
  await saveUsers(list.filter((u) => u.id !== userId));
  await fs.rm(userDir(userId), { recursive: true, force: true }).catch(() => {});
  return { ok: true };
}

export function resetUserCache(): void {
  cache = null;
}
