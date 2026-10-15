// dsh-icon-switch host entry.
//
// In-app icon operation for DeepSeek Harness (and DSH Desktop): a settings-
// driven plugin. The exported Config schema makes the host render this
// plugin's section in the app's Settings UI; the loopback-only HTTP routes
// (status / icons / action) let the user run the icon engine from inside
// the installed app, spawning the existing powershell engine script
// (dsh-icon-switch.ps1) from the tool directory.
//
// Safety design (this app was burned by broken plugins before):
//  * apply() never touches files unless the user explicitly asks via the
//    action route (POST) or opts into `actionOnSave`.
//  * Every route is fenced to loopback requests (socket 127/8 + Host header).
//  * Every engine execution is timeout-guarded; failures are logged and
//    never rethrown, so a broken engine cannot fail the host boot.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "dsh-icon-switch";
const ENGINE = "dsh-icon-switch.ps1";
// Tool directory resolution is relative to this module, never a machine path.
// - BUNDLED_TOOL_DIR: ships the PowerShell engines + a starter icon set inside
//   the package (../tool), so a fresh install works out of the box.
// - DEV_TOOL_DIR: an in-place source checkout keeps engines + icon sets at the
//   repo root, three levels above lib/. Prefer it when present so an existing
//   checkout keeps its icon data; a packaged install does not have it and
//   falls back to the bundled directory.
const PKG_DIR = dirname(fileURLToPath(import.meta.url));
const BUNDLED_TOOL_DIR = join(PKG_DIR, "..", "tool");
const DEV_TOOL_DIR = join(PKG_DIR, "..", "..", "..");
function defaultToolDir() {
	for (const candidate of [DEV_TOOL_DIR, BUNDLED_TOOL_DIR]) {
		if (existsSync(join(candidate, ENGINE))) return candidate;
	}
	return BUNDLED_TOOL_DIR;
}
const DEFAULT_TOOL_DIR = defaultToolDir();
const HTTP_BODY_LIMIT = 64 * 1024;
const UPLOAD_BODY_LIMIT = 12 * 1024 * 1024;
const UPLOAD_MAX_IMAGE = 8 * 1024 * 1024;
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
// Set names are engine-set identifiers: ASCII letters, digits, dot,
// underscore, hyphen, no path separators.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Icon file names also carry device-pixel-ratio suffixes such as
// "tray-icon-blue@2x.png", so '@' is allowed here; path separators and ".."
// stay forbidden (rejected explicitly below).
const SAFE_FILE = /^[A-Za-z0-9@][A-Za-z0-9@._-]*$/;
// Keep responses bounded: engine status output can be long.
const MAX_TEXT = 6000;
// 任务栏/标题栏图标助手（P/Invoke WM_SETICON，对已运行的窗口立即生效，无需重启）
const TASKBAR_HELPER = "dsh-taskbar-icon.ps1";

export const name = NAME;

export const ROUTES = {
	health: "/api/dsh-icon-switch/health",
	icons: "/api/dsh-icon-switch/icons",
	preview: "/api/dsh-icon-switch/preview",
	upload: "/api/dsh-icon-switch/upload",
	status: "/api/dsh-icon-switch/status",
	action: "/api/dsh-icon-switch/action",
	debug: "/api/dsh-icon-switch/debug"
};

// ---------------------------------------------------------------------------
// Config schema -> the plugin's section in the app's Settings UI.
//
// Schemastery is an OPTIONAL peer: the settings form is a nice-to-have. A
// statically-missing bare import would fail the whole module, so acquire the
// package dynamically and degrade to no-Config (settings section absent,
// loopback routes still working) when it cannot be resolved from this
// module's load path.
// ---------------------------------------------------------------------------
let Config;
try {
	const mod = await import("@deepseek-ai/schemastery");
	// @deepseek-ai/schemastery ships ONLY a default export (Schema). Accept
	// both shapes so a future named export cannot break this plugin.
	const Schema = mod?.Schema ?? mod?.default;
	if (typeof Schema?.object !== "function") throw new Error("no Schema.object");
	Config = Schema.object({
		enabled: Schema.boolean().default(true),
		toolDir: Schema.string().default(DEFAULT_TOOL_DIR),
		install: Schema.union(["auto", "harness", "desktop"]).default("auto"),
		iconSet: Schema.string().default("sample-blue"),
		actionOnSave: Schema.union(["none", "apply", "restore"]).default("none"),
		taskbarAfter: Schema.boolean().default(false),
		// 圆角：生成/应用图标时裁圆角，与 DSH 默认图标的圆角一致（可随时关掉还原直角）
		roundIcons: Schema.boolean().default(true),
		// 隐藏侧边栏顶部的品牌行（鲸鱼标 + DeepSeek Harness 字标，纯浏览器半侧 CSS，立即生效）
		hideSidebarBrand: Schema.boolean().default(false)
	}).volatile().description("DSH 图标切换 — 应用内管理 DeepSeek Harness / DSH Desktop 的应用与托盘图标");
} catch (error) {
	Config = undefined;
	try {
		console.warn(`[${NAME}] schemastery unavailable, settings form disabled: ${error?.message ?? error}`);
	} catch { /* ignore */ }
}

export { Config };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function writeJson(res, status, body, headers = {}) {
	const payload = JSON.stringify(body);
	try {
		res.writeHead(status, { ...JSON_HEADERS, ...headers });
		res.end(payload);
	} catch {
		// Response already sent or socket gone; nothing to do.
	}
}

function tail(text, max) {
	if (typeof text !== "string") return "";
	if (text.length <= max) return text;
	return "…" + text.slice(text.length - max);
}

/** Best-effort key listing for an object that may be a service proxy. */
function safeKeys(obj) {
	try {
		if (typeof obj !== "object" || obj === null) return [];
		return Object.keys(obj).slice(0, 40);
	} catch {
		return [];
	}
}

/** IPv4 127/8 predicate. */
function isIPv4Loopback(v4) {
	const parts = v4.split(".");
	if (parts.length !== 4) return false;
	if (parts[0] !== "127") return false;
	return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isLoopbackAddress(address) {
	if (address === void 0) return false;
	const n = String(address).toLowerCase();
	if (n === "::1") return true;
	if (n.startsWith("::ffff:")) return isIPv4Loopback(n.slice(7));
	return isIPv4Loopback(n);
}

function isLoopbackHostname(hostname) {
	return hostname === "localhost" || hostname === "[::1]" || isIPv4Loopback(hostname);
}

/**
 * Request-level trust fence: loopback socket AND loopback Host header,
 * mirroring the skill-explorer / dshmarket plugins.
 */
function isLoopbackRequest(request) {
	if (!isLoopbackAddress(request?.socket?.remoteAddress)) return false;
	const host = request?.headers?.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL("http://" + host);
	} catch {
		return false;
	}
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(String(origin)).host === hostUrl.host;
	} catch {
		return false;
	}
}

function readJsonBody(req, limit = HTTP_BODY_LIMIT) {
	// Defensive: if the host's web layer already parsed and consumed the body
	// (req.body set and the stream finished), use it instead of waiting forever
	// on a drained stream.
	if (req?.body !== void 0 && req.body !== null
		&& (req.readableEnded === true || req.complete === true)) {
		return Promise.resolve(req.body);
	}
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limit) {
				req.destroy();
				reject(new Error("body too large"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const raw = Buffer.concat(chunks).toString("utf8");
				resolve(raw ? JSON.parse(raw) : {});
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

/**
 * Decode a base64 data URL (data:image/...;base64,...) into a Buffer.
 * Returns null when the string does not look like one.
 */
function dataUrlToBuffer(value) {
	if (typeof value !== "string") return null;
	const match = /^data:image\/[a-zA-Z0-9.+_-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(value.trim());
	if (!match) return null;
	try {
		return Buffer.from(match[1].replace(/\s/g, ""), "base64");
	} catch {
		return null;
	}
}

/** Fast image-type sniff on magic bytes: png/jpeg/gif/bmp. */
function sniffImageType(buf) {
	if (!buf || buf.length < 4) return null;
	if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
	if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "gif";
	if (buf[0] === 0x42 && buf[1] === 0x4d) return "bmp";
	return null;
}

/**
 * Decode engine output best-effort: powershell.exe pipes console output in
 * the system code page (GBK on this machine), so try UTF-8 first and fall
 * back to GBK when the UTF-8 decode looks mangled.
 */
function decodeBuffer(buf) {
	if (!buf || buf.length === 0) return "";
	let text = buf.toString("utf8");
	if (!text.includes("\uFFFD")) return text;
	const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
	const total = text.length;
	if (total > 0 && cjk / total > 0.02) return text;
	try {
		return new TextDecoder("gbk").decode(buf);
	} catch {
		return text;
	}
}

function resolveIconSets(toolDir) {
	try {
		const iconsDir = join(toolDir, "icons");
		if (!existsSync(iconsDir)) return [];
		const sets = [];
		for (const entry of readdirSync(iconsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = join(iconsDir, entry.name);
			if (readdirSync(dir).length > 0) sets.push(entry.name);
		}
		return sets.sort();
	} catch {
		return [];
	}
}

/** Preferred preview file per set: app icon first, then any png, then ico. */
function previewFileOf(files) {
	const names = files.map((f) => f.name);
	for (const want of ["app-icon.png", "app-icon.ico", "tray-icon-blue.png"]) {
		if (names.includes(want)) return want;
	}
	const png = names.find((n) => /\.png$/i.test(n));
	return png ?? files[0]?.name ?? null;
}

/** Per-set detail: { name, files: [{name,size}], preview }. */
function resolveIconSetDetails(toolDir) {
	try {
		const iconsDir = join(toolDir, "icons");
		if (!existsSync(iconsDir)) return [];
		const out = [];
		for (const entry of readdirSync(iconsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = join(iconsDir, entry.name);
			let files = [];
			try {
				files = readdirSync(dir)
					.filter((n) => !n.startsWith("."))
					.map((n) => {
						let size = 0;
						try { size = statSync(join(dir, n)).size; } catch { /* stat race */ }
						return { name: n, size };
					})
					.sort((a, b) => a.name.localeCompare(b.name));
			} catch { /* ignore */ }
			if (files.length === 0) continue;
			out.push({ name: entry.name, files, preview: previewFileOf(files) });
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

/**
 * Process name whose main window carries the taskbar button, per install flavour.
 */
function taskbarProcessName(install) {
	return install === "desktop" ? "DSH Desktop" : "DeepSeek Harness";
}

/**
 * Icon used for live windows: the set's multi-size ICO.
 */
function taskbarIconPath(toolDir, setName) {
	return join(toolDir, "icons", setName, "app-icon.ico");
}

/**
 * Preferred way to retarget the running windows: ask Electron itself. The
 * image is owned by the app process, so it survives this plugin call.
 * Returns { ok, via, windows } or { ok: false, reason }.
 */
async function setIconViaElectron(icoPath) {
	try {
		const { createRequire } = await import("node:module");
		const electron = createRequire(import.meta.url)("electron");
		const wins = electron?.BrowserWindow?.getAllWindows?.() ?? [];
		if (wins.length === 0) return { ok: false, reason: "no BrowserWindow in this host" };
		let applied = 0;
		for (const win of wins) {
			try { win.setIcon(icoPath); applied++; } catch { /* per-window failure */ }
		}
		return applied > 0 ? { ok: true, via: "electron", windows: applied } : { ok: false, reason: "setIcon() failed" };
	} catch (error) {
		return { ok: false, reason: String(error?.message ?? error) };
	}
}

/**
 * Fallback: WM_SETICON through the helper script. The helper must KEEP RUNNING —
 * the HICON it sets is owned by the helper process, so a -Once run leaves the
 * window with a dangling handle (the icon renders blank). We therefore stop any
 * earlier watcher and start one detached in watch mode.
 */
function startTaskbarWatcher(helper, icoPath, processName) {
	try {
		const child = spawn(
			"powershell.exe",
			["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper,
				"-Icon", icoPath, "-ProcessName", processName, "-Seconds", "10"],
			{ detached: true, stdio: "ignore", windowsHide: true }
		);
		child.unref();
		return { ok: true, via: "watcher", pid: child.pid };
	} catch (error) {
		return { ok: false, reason: String(error?.message ?? error) };
	}
}

/** Kill previously started dsh-taskbar-icon watchers (one watcher at a time). */
function stopTaskbarWatchers() {
	return new Promise((resolve) => {
		const script = "foreach ($p in Get-CimInstance Win32_Process) { if ($p.CommandLine -like '*dsh-taskbar-icon.ps1*') { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } }";
		try {
			const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "ignore", windowsHide: true });
			child.on("exit", () => resolve());
			child.on("error", () => resolve());
		} catch { resolve(); }
	});
}

/**
 * Retarget the running windows to a set's icon: Electron first, WM_SETICON
 * watcher as fallback. Returns { ok, ... } and never throws.
 */
async function applyTaskbarIcon(toolDir, install, setName) {
	const ico = taskbarIconPath(toolDir, setName);
	if (!existsSync(ico)) return { ok: false, error: "icon not found for set", set: setName, icon: ico };
	const direct = await setIconViaElectron(ico);
	if (direct.ok) return { ok: true, icon: ico, via: direct.via, windows: direct.windows };
	const helper = join(toolDir, TASKBAR_HELPER);
	if (!existsSync(helper)) return { ok: false, error: "taskbar helper missing", helper, electron: direct.reason };
	await stopTaskbarWatchers();
	const watch = startTaskbarWatcher(helper, ico, taskbarProcessName(install));
	return watch.ok
		? { ok: true, icon: ico, via: watch.via, pid: watch.pid, electron: direct.reason }
		: { ok: false, error: "watch helper failed", reason: watch.reason, electron: direct.reason };
}

/**
 * Run the engine powershell script with args; returns { code, signal, text }
 * where text has stdout (and stderr on failure).
 */
function runEngine(engine, args, timeoutMs = 90000) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(
				"powershell.exe",
				["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", engine, ...args],
				{ windowsHide: true }
			);
		} catch (error) {
			resolve({ code: -1, text: String(error?.message ?? error) });
			return;
		}
		const out = [];
		const err = [];
		child.stdout?.on("data", (d) => out.push(Buffer.from(d)));
		child.stderr?.on("data", (d) => err.push(Buffer.from(d)));
		const timer = setTimeout(() => {
			try { child.kill(); } catch { /* already gone */ }
		}, timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ code: -2, text: String(error?.message ?? error) });
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			const stdout = decodeBuffer(Buffer.concat(out));
			const stderr = decodeBuffer(Buffer.concat(err));
			let text = stdout;
			if (code !== 0 && stderr) text = (stdout ? stdout + "\n[stderr]\n" : "") + stderr;
			resolve({ code, signal, text: tail(text, MAX_TEXT) });
		});
	});
}

/**
 * Single-instance guard: the aggregate web bundle and a standalone install
 * can coexist in one profile, so a second host apply must be a no-op instead
 * of re-registering the same routes and failing the boot.
 */
function singleInstance(pluginId, fn) {
	let mounted = false;
	return (...args) => {
		if (mounted) return;
		mounted = true;
		const ctx = args[0];
		if (typeof ctx?.effect === "function") {
			ctx.effect(() => () => {
				mounted = false;
			});
		}
		try {
			fn(...args);
		} catch (error) {
			mounted = false;
			try {
				ctx?.logger?.warn?.(`[${pluginId}] apply failed: ${String(error?.message ?? error)}`);
			} catch { /* ignore */ }
		}
	};
}

/**
 * Register the loopback routes on the injected webServer service.
 * `o` = { toolDir, install, iconSet, engine, hasEngine }.
 */
function mountRoutes(ctx, host, o) {
	ctx.effect(
		() => {
			const disposers = [
				host.webServer.register({
					kind: "exact",
					path: ROUTES.health,
					handler: async (req, res) => {
						writeJson(res, 200, { ok: true, name: NAME, toolDir: o.toolDir, hasEngine: o.hasEngine });
					}
				}),
				host.webServer.register({
					kind: "exact",
					path: ROUTES.icons,
					handler: async (req, res) => {
						if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: "forbidden: loopback-only" });
						if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
						writeJson(res, 200, { ok: true, icons: resolveIconSetDetails(o.toolDir) });
					}
				}),
				host.webServer.register({
					kind: "exact",
					path: ROUTES.preview,
					handler: async (req, res) => {
						if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: "forbidden: loopback-only" });
						if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
						const url = new URL(req.url ?? "/", "http://" + (req.headers?.host ?? "127.0.0.1"));
						const set = url.searchParams.get("set") ?? "";
						const file = url.searchParams.get("file") ?? "";
						if (!SAFE_NAME.test(set) || !SAFE_FILE.test(file) || file.includes("..")) {
							return writeJson(res, 400, { error: "bad set/file" });
						}
						const iconsDir = join(o.toolDir, "icons");
						const full = join(iconsDir, set, file);
						if (!full.startsWith(iconsDir + "\\") && !full.startsWith(iconsDir + "/")) {
							return writeJson(res, 400, { error: "path escape" });
						}
						let stat;
						try {
							stat = statSync(full);
						} catch {
							return writeJson(res, 404, { error: "file not found" });
						}
						if (!stat.isFile() || stat.size > PREVIEW_MAX_BYTES) {
							return writeJson(res, 400, { error: "not a previewable file" });
						}
						let body;
						try {
							body = readFileSync(full);
						} catch (error) {
							return writeJson(res, 500, { error: "read failed: " + String(error?.message ?? error) });
						}
						const lower = file.toLowerCase();
						const type = lower.endsWith(".png") ? "image/png"
							: lower.endsWith(".svg") ? "image/svg+xml"
							: lower.endsWith(".ico") ? "image/x-icon"
							: lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg"
							: lower.endsWith(".gif") ? "image/gif"
							: lower.endsWith(".bmp") ? "image/bmp"
							: "application/octet-stream";
						try {
							res.writeHead(200, {
								"content-type": type,
								"content-length": body.length,
								"cache-control": "no-store"
							});
							res.end(body);
						} catch {
							// Socket gone; nothing to do.
						}
					}
				}),
				host.webServer.register({
					kind: "exact",
					path: ROUTES.upload,
					handler: async (req, res) => {
						if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: "forbidden: loopback-only" });
						if (req.method !== "POST") return writeJson(res, 405, { error: "method not allowed" });
						if (!o.hasEngine) return writeJson(res, 500, { error: "engine missing", toolDir: o.toolDir });
						let body;
						try {
							body = await readJsonBody(req, UPLOAD_BODY_LIMIT);
						} catch (error) {
							return writeJson(res, 400, { error: "invalid body: " + String(error?.message ?? error) });
						}
						const buf = dataUrlToBuffer(body?.image);
						// 圆角：页面上的勾选优先于已保存的配置（未保存也能按当前选择上传）
						const round = typeof body?.round === "boolean" ? body.round : o.round !== false;
						if (!buf) return writeJson(res, 400, { error: "image must be a base64 data URL" });
						if (buf.length === 0) return writeJson(res, 400, { error: "empty image" });
						if (buf.length > UPLOAD_MAX_IMAGE) {
							return writeJson(res, 400, { error: `image too large (max ${UPLOAD_MAX_IMAGE} bytes)` });
						}
						if (!sniffImageType(buf)) {
							return writeJson(res, 400, { error: "unsupported image type (png/jpeg/gif/bmp)" });
						}
						let name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "";
						if (!name) name = "upload-" + Date.now().toString(36);
						if (!SAFE_NAME.test(name) || name.length > 64) {
							return writeJson(res, 400, { error: "bad set name" });
						}
						const iconsDir = join(o.toolDir, "icons");
						const target = join(iconsDir, name);
						if (existsSync(target)) {
							return writeJson(res, 409, { error: `set "${name}" already exists` });
						}
						const tmp = join(tmpdir(), `dsh-icon-switch-${Date.now().toString(36)}.png`);
						let wrote = false;
						try {
							writeFileSync(tmp, buf);
							wrote = true;
						} catch (error) {
							return writeJson(res, 500, { error: "temp write failed: " + String(error?.message ?? error) });
						}
						let r;
						try {
							const upArgs = ["new", "-Name", name, "-SourceImage", tmp, "-ToolDir", o.toolDir];
							if (round) upArgs.push("-Round");
							r = await runEngine(o.engine, upArgs, 120000);
						} finally {
							if (wrote) { try { unlinkSync(tmp); } catch { /* ignore */ } }
						}
						if (r.code !== 0) {
							return writeJson(res, 500, { ok: false, code: r.code, text: r.text });
						}
						const set = resolveIconSetDetails(o.toolDir).find((s) => s.name === name) ?? { name, files: [], preview: null };
						writeJson(res, 200, { ok: true, name, files: set.files, preview: set.preview, text: r.text });
					}
				}),
				host.webServer.register({
					kind: "exact",
					path: ROUTES.status,
					handler: async (req, res) => {
						if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: "forbidden: loopback-only" });
						if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
						if (!o.hasEngine) return writeJson(res, 500, { error: "engine missing", toolDir: o.toolDir });
						const r = await runEngine(o.engine, ["status", "-Install", o.install, "-ToolDir", o.toolDir]);
						writeJson(res, r.code === 0 ? 200 : 500, { ok: r.code === 0, code: r.code, text: r.text });
					}
				}),
				host.webServer.register({
					kind: "exact",
					path: ROUTES.action,
					handler: async (req, res) => {
						if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: "forbidden: loopback-only" });
						if (req.method !== "POST") return writeJson(res, 405, { error: "method not allowed" });
						if (!o.hasEngine) return writeJson(res, 500, { error: "engine missing", toolDir: o.toolDir });
						let body = {};
						try {
							body = await readJsonBody(req);
						} catch (error) {
							return writeJson(res, 400, { error: "invalid body: " + String(error?.message ?? error) });
						}
						const action = body.action;
						if (action !== "apply" && action !== "restore" && action !== "taskbar") {
							return writeJson(res, 400, { error: "action must be 'apply', 'restore' or 'taskbar'" });
						}
						const install = typeof body.install === "string" ? body.install : o.install;
						const name = typeof body.iconSet === "string" && body.iconSet.trim() ? body.iconSet.trim() : o.iconSet;
						// 任务栏/标题栏图标：对已运行的窗口立即生效（不动文件、无需重启）
						if (action === "taskbar") {
							const taskbar = await applyTaskbarIcon(o.toolDir, install, name);
							if (!taskbar.ok) return writeJson(res, taskbar.error === "icon not found for set" ? 404 : 500, taskbar);
							return writeJson(res, 200, { action, ...taskbar });
						}
						const args = [action];
						if (action === "apply") {
							args.push(name);
							const round = typeof body.round === "boolean" ? body.round : o.round !== false;
							if (round) args.push("-Round");
						}
						args.push("-Install", install);
						args.push("-ToolDir", o.toolDir);
						const r = await runEngine(o.engine, args);
						// 设置里勾了"同时设置任务栏图标"时，应用成功后立刻换掉运行中窗口的图标
						let taskbar = null;
						if (r.code === 0 && action === "apply" && body.taskbarAfter === true) {
							taskbar = await applyTaskbarIcon(o.toolDir, install, name);
						}
						writeJson(res, r.code === 0 ? 200 : 500, {
							ok: r.code === 0,
							code: r.code,
							action,
							text: r.text,
							taskbar
						});
					}
				}),
				host.webServer.register({
					kind: "exact",
					path: ROUTES.debug,
					handler: async (req, res) => {
						if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: "forbidden: loopback-only" });
						if (req.method !== "GET") return writeJson(res, 405, { error: "method not allowed" });
						// Diagnostic: ask the running host how the Settings page's
						// describe() input is built. SettingsForms.describe()
						// iterates configEditor.configuration() and emits one
						// namespace per entry that passes ALL of:
						//   entry.parent.tree.ctx.fiber.entry?.id === "include"
						//   entry.fiber?.runtime?.Config has "toJSON"
						//   entry.fiber.state === 2 (ACTIVE)
						//   volatileForm(schema) !== undefined
						// Everything below reproduces that walk so we can see
						// exactly which gate drops our entry (or all entries).
						const out = { ok: true, name: NAME, probes: {} };
						// Resolve a service by direct property / get, no filtering.
						const svc = (name) => {
							for (const src of [host, ctx]) {
								if (!src) continue;
								try {
									const v = typeof src.get === "function" ? src.get(name) : src[name];
									if (v) return v;
								} catch { /* next */ }
								try {
									if (src[name]) return src[name];
								} catch { /* next */ }
							}
							return undefined;
						};
						// 1. settings service -> describe() output (ground truth).
						// NOTE: this host's describe() returns a FLAT ARRAY of
						// descriptors ({ns, schema, revision, applies, value, ...}),
						// NOT a {writable,namespaces:[...]} wrapper. Array has no
						// .namespaces -> old probe always showed 0. Read the raw array.
						try {
							const s = svc("settings");
							if (!s) {
								out.probes.settings = { error: "settings service not resolvable on host or ctx" };
							} else if (typeof s.describe !== "function") {
								out.probes.settings = { error: "settings has no describe()", settingsType: typeof s, settingsKeys: safeKeys(s) };
							} else {
								const raw = await s.describe({ redactSecrets: false });
								const isArr = Array.isArray(raw);
								const list = isArr ? raw : (raw && Array.isArray(raw.namespaces)) ? raw.namespaces : null;
								out.probes.settings = {
									rawType: typeof raw,
									rawIsArray: isArr,
									rawKeys: isArr || !raw ? null : safeKeys(raw),
									count: list ? list.length : -1,
									namespaces: list ? list.map((row) => ({
										ns: row?.ns,
										applies: row?.applies,
										revision: row?.revision,
										autoGenerate: row?.autoGenerate,
										schema: row?.schema,
										value: row?.value
									})) : null,
									hasOurs: list ? list.some((row) => row?.ns === NAME) : false
								};
							}
						} catch (error) {
							out.probes.settings = { error: String(error?.message ?? error) };
						}
						// 1b. configEditor.configuration() — describe()'s REAL input
						// (it iterates configuration(), not entries()); we probe it.
						try {
							const ce = svc("configEditor");
							if (!ce) {
								out.probes.configEditorConfiguration = { error: "configEditor service not resolvable" };
							} else if (typeof ce.configuration !== "function") {
								out.probes.configEditorConfiguration = { error: "configEditor has no configuration()", keys: safeKeys(ce) };
							} else {
								const rows = ce.configuration();
								const list = Array.isArray(rows) ? rows : [...rows];
								out.probes.configEditorConfiguration = {
									count: list.length,
									rows: list.map((row) => ({
										id: row?.entry?.options?.id,
										parentTreeFiber: row?.entry?.parent?.tree?.ctx?.fiber?.entry?.id ?? null,
										haveOverride: row?.override != null,
										haveInherited: row?.inherited != null,
										override: row?.override
									}))
								};
							}
						} catch (error) {
							out.probes.configEditorConfiguration = { error: String(error?.message ?? error) };
						}
						// 2. configEditor -> entries() (the include-tree membership).
						try {
							const ce = svc("configEditor");
							if (!ce) {
								out.probes.configEditor = { error: "configEditor service not resolvable on host or ctx", hostKeys: host ? safeKeys(host) : null, ctxKeys: ctx ? safeKeys(ctx) : null };
							} else {
								const entries = typeof ce.entries === "function" ? ce.entries() : [];
								const list = Array.isArray(entries) ? entries : [...entries];
								out.probes.configEditor = {
									entryCount: list.length,
									ids: list.map((entry) => ({
										id: entry?.options?.id,
										parentTreeFiber: entry?.parent?.tree?.ctx?.fiber?.entry?.id ?? null,
										includeGate: entry?.parent?.tree?.ctx?.fiber?.entry?.id === "include",
										hasFiber: entry?.fiber != null,
										fiberState: entry?.fiber?.state,
										runtimeConfigToJSON: typeof entry?.fiber?.runtime?.Config?.toJSON
									}))
								};
							}
						} catch (error) {
							out.probes.configEditor = { error: String(error?.message ?? error) };
						}
						// 3. loader -> entry tree snapshot (all entries, any depth).
						try {
							const loader = svc("loader");
							if (!loader) {
								out.probes.loader = { error: "loader not resolvable" };
							} else if (typeof loader.entries !== "function") {
								out.probes.loader = { error: "loader has no entries()", loaderType: typeof loader };
							} else {
								const iter = loader.entries();
								const list = Array.isArray(iter) ? iter : [...iter];
								out.probes.loader = {
									entryCount: list.length,
									// Reproduce the configEditor include gate on every entry.
									gates: {
										includeCandidates: list.filter((entry) => entry?.parent?.tree?.ctx?.fiber?.entry?.id === "include").map((entry) => entry?.options?.id),
										active: list.filter((entry) => entry?.fiber?.state === 2).map((entry) => entry?.options?.id),
										withConfigToJSON: list.filter((entry) => typeof entry?.fiber?.runtime?.Config?.toJSON === "function").map((entry) => entry?.options?.id)
									},
									ours: list
										.filter((entry) => entry?.options?.id === NAME)
										.map((entry) => ({
											id: entry?.options?.id,
											options: entry?.options,
											parentTreeFiber: entry?.parent?.tree?.ctx?.fiber?.entry?.id ?? null,
											fiberState: entry?.fiber?.state,
											runtimeHasConfig: entry?.fiber?.runtime?.Config != null,
											runtimeConfigToJSON: typeof entry?.fiber?.runtime?.Config?.toJSON
										}))
								};
							}
						} catch (error) {
							out.probes.loader = { error: String(error?.message ?? error) };
						}
						// 4. our own module's Config shape (what the loader sees).
						out.probes.ownConfig = {
							hasConfigExport: typeof Config === "function",
							volatile: Config?.meta?.volatile ?? null,
							hasToJSON: typeof Config?.toJSON === "function",
							dict: Config?.dict ? Object.keys(Config.dict) : null
						};
						writeJson(res, 200, out);
					}
				})
			];
			return () => {
				for (const dispose of disposers) dispose();
			};
		},
		"dsh-icon-switch: routes"
	);
}

/**
 * Acquire the webServer service the way dshmarket does (ctx.inject([...], cb));
 * fall back to a directly-present ctx.webServer on hosts without the inject API.
 */
function applyRoutes(ctx, o) {
	if (typeof ctx.inject === "function") {
		ctx.inject(["webServer"], (host) => {
			mountRoutes(ctx, host, o);
		});
	} else if (ctx.webServer !== void 0) {
		mountRoutes(ctx, ctx, o);
	}
}

function applyImpl(ctx, config) {
	if (config?.enabled === false) return;
	const toolDir = config?.toolDir ?? DEFAULT_TOOL_DIR;
	const install = config?.install ?? "auto";
	const iconSet = config?.iconSet ?? "sample-blue";
	const engine = join(toolDir, ENGINE);
	const hasEngine = existsSync(engine);

	applyRoutes(ctx, { toolDir, install, iconSet, engine, hasEngine, round: config?.roundIcons !== false });

	// Deferred settings-driven action: runs only when the user explicitly
	// chose apply/restore in the settings form. Never throws into the boot.
	if (config?.actionOnSave === "apply" || config?.actionOnSave === "restore") {
		const action = config.actionOnSave;
		setTimeout(() => {
			if (!hasEngine) {
				try { ctx.logger?.warn?.(`[${NAME}] actionOnSave=${action} skipped: engine missing (${toolDir})`); } catch { /* ignore */ }
				return;
			}
			const args = [action];
			if (action === "apply") {
				args.push(iconSet);
				if (config?.roundIcons !== false) args.push("-Round");
			}
			args.push("-Install", install);
			args.push("-ToolDir", toolDir);
			runEngine(engine, args, 120000).then((r) => {
				try {
					if (r.code === 0) {
						ctx.logger?.info?.(`[${NAME}] ${action} done (${iconSet})`);
					} else {
						ctx.logger?.warn?.(`[${NAME}] ${action} failed code=${r.code}: ${tail(r.text, 600)}`);
					}
				} catch { /* ignore */ }
				// 勾选"同时设置任务栏图标"时，应用完成后立即给运行中的窗口换图标
				if (r.code === 0 && action === "apply" && config?.taskbarAfter === true) {
					applyTaskbarIcon(toolDir, install, iconSet).then((t) => {
						try {
							ctx.logger?.[t.ok ? "info" : "warn"]?.(
								`[${NAME}] taskbar icon ${t.ok ? `set via ${t.via}` : `failed: ${t.error ?? t.reason}`}`
							);
						} catch { /* ignore */ }
					}).catch(() => { /* never throw into boot */ });
				}
			});
		}, 1500);
	}

	// 勾选了"同时设置任务栏图标"时，这次启动就接管任务栏图标：插件加载时主窗口
	// 往往还没建好，只有常驻助手才能覆盖到之后才出现的窗口。
	if (config?.taskbarAfter === true) {
		const helper = join(toolDir, TASKBAR_HELPER);
		const ico = taskbarIconPath(toolDir, iconSet);
		if (existsSync(helper) && existsSync(ico)) {
			stopTaskbarWatchers()
				.then(() => {
					const t = startTaskbarWatcher(helper, ico, taskbarProcessName(install));
					try {
						ctx.logger?.[t.ok ? "info" : "warn"]?.(`[${NAME}] taskbar watcher ${t.ok ? `started pid=${t.pid}` : `failed: ${t.reason}`}`);
					} catch { /* ignore */ }
				})
				.catch(() => { /* never throw into boot */ });
		}
	}

	try {
		ctx.logger?.info?.(
			`[${NAME}] loaded (toolDir=${toolDir}, engine=${hasEngine ? "ok" : "missing"}, install=${install}, iconSet=${iconSet})`
		);
	} catch { /* ignore */ }
}

const apply = singleInstance(NAME, applyImpl);

export { apply };