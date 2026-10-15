window.__ModuleLoader__.load({
	id: "dsh-icon-switch",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region dictionary
		/** Dictionary namespace owned by the plugin (matches the Host entry id). */
		const NS = "dsh-icon-switch";
		/** The settings namespace the Host serves; same id the entry registers with. */
		const SETTINGS_NS = "dsh-icon-switch";
		/**
		* The brand row is filled by the official brand bundle through the
		* `sidebar.brand.mark` / `sidebar.brand.name` single slots, and the row's
		* own markup belongs to the shell — so hiding it takes CSS. Class names
		* are CSS-module hashes per build, hence the stable `_brandIdentity` /
		* `_logoRow` suffixes instead of a hash-prefixed selector.
		*
		* Only the brand identity (whale mark + wordmark) may be hidden: the row
		* also carries the sidebar collapse/expand toggle, so `display:none` on
		* the row would take that button away too. The toggle is `position:fixed`
		* in the Windows titlebar shell and lives in `topStrip` on macOS — in both
		* cases it is outside the row's flow, so only those two shells may also
		* collapse the row's empty height (`overflow:visible` guards the fixed
		* button in case it ever gains a containing block inside the row).
		*/
		const HIDE_BRAND_CSS = [
			"[class*=\"_brandIdentity\"]{display:none !important}",
			"[data-windows-titlebar] [class*=\"_logoRow\"]{height:0 !important;margin:0 !important;padding:0 !important;overflow:visible !important}",
			"[data-platform=darwin] [class*=\"_logoRow\"]{height:0 !important;margin-bottom:0 !important;padding:0 !important;overflow:visible !important}"
		].join("");
		/**
		* This section's own stylesheet. A settings section owns its layout, so the
		* spacing, dividers and controls follow the official settings language:
		* semantic `--dsw-alias-*` tokens only (plus the settings-card pair), 0.5px
		* neutral borders, and no hard-coded colors. Injected once per page, the
		* way every official client bundle carries its module CSS.
		*/
		const SECTION_CSS_ID = "@deepseek-ai/dsh-icon-switch/IconSwitchSection.module.css";
		const SECTION_CSS = [
			".dsi_section{max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}",
			".dsi_heading{margin:0;font-size:18px;font-weight:600}",
			".dsi_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}",
			".dsi_block{flex-direction:column;gap:8px;display:flex}",
			".dsi_blockTitle{margin:0;font-size:15px;font-weight:600;line-height:22px}",
			".dsi_blockHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}",
			".dsi_cards{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px;margin:0;padding:0;list-style:none;display:grid}",
			".dsi_card{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill);color:var(--dsw-alias-label-primary);font:inherit;flex-direction:column;align-items:center;gap:6px;min-width:0;padding:10px 8px;cursor:pointer;display:flex}",
			".dsi_card:hover:enabled{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsi_card[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover-accent)}",
			".dsi_card:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
			".dsi_thumb{width:48px;height:48px;align-items:center;justify-content:center;display:inline-flex}",
			".dsi_thumb img{width:48px;height:48px;object-fit:contain;display:block}",
			".dsi_thumbFallback{color:var(--dsw-alias-label-tertiary);font-size:24px;line-height:48px}",
			".dsi_cardName{max-width:100%;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-size:12px;line-height:18px}",
			".dsi_uploadRow{align-items:center;flex-wrap:wrap;gap:8px;display:flex}",
			".dsi_file{color:var(--dsw-alias-label-secondary);max-width:100%;font-size:12px;line-height:18px}",
			".dsi_input{display:flex;width:100%}",
			".dsi_inputRow{display:flex;flex:0 1 260px;min-width:180px}",
			".dsi_rows{flex-direction:column;display:flex}",
			".dsi_rows>*+*{border-top:.5px solid var(--dsw-alias-border-l2)}",
			".dsi_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
			".dsi_row{justify-content:space-between;align-items:center;gap:24px;padding:12px 0;display:flex}",
			".dsi_rowText{min-width:0}",
			".dsi_label{font-size:13px;font-weight:500;line-height:1.5}",
			".dsi_hint{color:var(--dsw-alias-label-tertiary);margin:4px 0 0;font-size:12px;line-height:1.5}",
			".dsi_control{flex:none;align-items:center;display:inline-flex}",
			".dsi_select{height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}",
			".dsi_select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}",
			".dsi_actions{align-items:center;flex-wrap:wrap;gap:8px;display:flex}",
			".dsi_note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
			".dsi_noteOk{color:var(--dsw-alias-state-success-primary)}",
			".dsi_noteFail{color:var(--dsw-alias-state-error-primary)}"
		].join("");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(SECTION_CSS_ID) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-icon-switch";
			tag.dataset.pluginCss = SECTION_CSS_ID;
			tag.textContent = SECTION_CSS;
			document.head.appendChild(tag);
		}
		/** Class names of {@link SECTION_CSS}, keyed like a CSS-module map. */
		const cls = {
			section: "dsi_section",
			heading: "dsi_heading",
			intro: "dsi_intro",
			block: "dsi_block",
			blockTitle: "dsi_blockTitle",
			blockHint: "dsi_blockHint",
			cards: "dsi_cards",
			card: "dsi_card",
			thumb: "dsi_thumb",
			thumbFallback: "dsi_thumbFallback",
			cardName: "dsi_cardName",
			uploadRow: "dsi_uploadRow",
			file: "dsi_file",
			input: "dsi_input",
			inputRow: "dsi_inputRow",
			rows: "dsi_rows",
			field: "dsi_field",
			row: "dsi_row",
			rowText: "dsi_rowText",
			label: "dsi_label",
			hint: "dsi_hint",
			control: "dsi_control",
			select: "dsi_select",
			actions: "dsi_actions",
			note: "dsi_note",
			noteOk: "dsi_noteOk",
			noteFail: "dsi_noteFail"
		};
		const zh = {
			nav: "DSH 图标切换",
			hint: "应用内管理 DeepSeek Harness / DSH Desktop 的应用与托盘图标。保存后可在设置页外查看效果。",
			fieldEnabled: "启用插件",
			fieldEnabledHint: "关闭后本插件不再响应配置变更。",
			fieldToolDir: "工具目录",
			fieldToolDirHint: "dsh-icon-switch.ps1 所在目录；留空使用插件默认目录。",
			fieldInstall: "安装目标",
			fieldInstallHint: "auto / harness / desktop（harness=DeepSeek Harness，desktop=DSH Desktop）。",
			fieldIconSet: "图标集",
			fieldIconSetHint: "icons/ 下的图标集名称，如 default、sample-blue。",
			fieldActionOnSave: "保存后应用",
			fieldActionOnSaveHint: "保存配置后自动运行引擎切换图标（none=不执行，apply=应用，restore=还原）。",
			fieldTaskbarAfter: "同时设置任务栏图标",
			fieldTaskbarAfterHint: "应用后立即设置任务栏图标，之后每次启动应用也自动设置（托盘图标仍需完全重启应用）。",
			fieldRoundIcons: "圆角图标",
			fieldRoundIconsHint: "上传和应用时把方角图裁成圆角（与 DeepSeek Harness 默认图标的圆角一致）。原图会保留为 source.png，关掉再应用即可还原直角。",
			fieldHideSidebarBrand: "隐藏侧边栏品牌行",
			fieldHideSidebarBrandHint: "隐藏左侧边栏顶部的鲸鱼标与 DeepSeek Harness 字标，并收掉空出来的高度。收起/展开侧边栏的按钮会保留。开关立即生效，无需重启。",
			galleryTitle: "图标集",
			galleryHint: "点击缩略图选择要应用的图标集。",
			uploadTitle: "上传图片生成图标",
			uploadHint: "选择 PNG / JPEG / GIF / BMP 图片，将自动生成整套应用与托盘图标（多尺寸 PNG + ICO）。",
			uploadChoose: "选择图片",
			uploadNamePlaceholder: "图标集名称（留空自动生成）",
			uploadGenerate: "生成图标集",
			uploading: "生成中…",
			uploadOk: "已生成并选中",
			uploadFail: "生成失败",
			save: "保存",
			saving: "保存中…",
			saveFailed: "保存失败",
			unavailable: "宿主未提供 dsh-icon-switch 条目。",
			readOnly: "只读",
			applyNow: "立即应用",
			applied: "已应用",
			applyFailed: "应用失败",
			taskbarNow: "立即设置任务栏图标",
			taskbarOk: "任务栏图标已设置（托盘图标需完全重启应用）",
			taskbarFail: "任务栏图标设置失败"
		};
		const en = {
			nav: "DSH Icon Switch",
			hint: "Manage the application and tray icons of DeepSeek Harness / DSH Desktop from inside the app.",
			fieldEnabled: "Enable plugin",
			fieldEnabledHint: "When off, the plugin stops responding to configuration changes.",
			fieldToolDir: "Tool directory",
			fieldToolDirHint: "Folder containing dsh-icon-switch.ps1; leave empty for the plugin default.",
			fieldInstall: "Install target",
			fieldInstallHint: "auto / harness / desktop (harness=DeepSeek Harness, desktop=DSH Desktop).",
			fieldIconSet: "Icon set",
			fieldIconSetHint: "Name of the set under icons/, e.g. default or sample-blue.",
			fieldActionOnSave: "Apply on save",
			fieldActionOnSaveHint: "Run the engine automatically after saving (none, apply, restore).",
			fieldTaskbarAfter: "Set taskbar icon after",
			fieldTaskbarAfterHint: "Set the taskbar icon right after applying, and again on every app start (the tray icon still needs a full app restart).",
			fieldRoundIcons: "Rounded icons",
			fieldRoundIconsHint: "Clip square icons to rounded corners when uploading and applying, matching the DeepSeek Harness default icon. The square original is kept as source.png — turn this off and apply again to restore it.",
			fieldHideSidebarBrand: "Hide sidebar brand row",
			fieldHideSidebarBrandHint: "Hide the whale mark and DeepSeek Harness wordmark at the top of the left sidebar and collapse the space they leave. The sidebar collapse/expand button is kept. Applies immediately, no restart.",
			galleryTitle: "Icon sets",
			galleryHint: "Click a thumbnail to pick the icon set to apply.",
			uploadTitle: "Upload image to generate icons",
			uploadHint: "Pick a PNG / JPEG / GIF / BMP image; a full set of app and tray icons (multi-size PNG + ICO) is generated.",
			uploadChoose: "Choose image",
			uploadNamePlaceholder: "Set name (auto-generated when empty)",
			uploadGenerate: "Generate icon set",
			uploading: "Generating…",
			uploadOk: "Generated and selected",
			uploadFail: "Generation failed",
			save: "Save",
			saving: "Saving…",
			saveFailed: "Save failed",
			unavailable: "The host does not serve the dsh-icon-switch entry.",
			readOnly: "Read only",
			applyNow: "Apply now",
			applied: "Applied",
			applyFailed: "Apply failed",
			taskbarNow: "Set taskbar icon now",
			taskbarOk: "Taskbar icon set (tray icon needs a full restart)",
			taskbarFail: "Failed to set the taskbar icon"
		};
		//#endregion
		/** Services required by the Settings registration. */
		const inject = [
			"slots",
			"locale",
			"configForms"
		];
		//#region section component
		const FIELD_ROWS = [
			["enabled", "fieldEnabled", "fieldEnabledHint", "bool"],
			["toolDir", "fieldToolDir", "fieldToolDirHint", "text"],
			["install", "fieldInstall", "fieldInstallHint", "enum", ["auto", "harness", "desktop"]],
			["iconSet", "fieldIconSet", "fieldIconSetHint", "text"],
			["actionOnSave", "fieldActionOnSave", "fieldActionOnSaveHint", "enum", ["none", "apply", "restore"]],
			["taskbarAfter", "fieldTaskbarAfter", "fieldTaskbarAfterHint", "bool"],
			["roundIcons", "fieldRoundIcons", "fieldRoundIconsHint", "bool"],
			["hideSidebarBrand", "fieldHideSidebarBrand", "fieldHideSidebarBrandHint", "bool"]
		];
		function normalizeValue(value) {
			const base = value !== null && typeof value === "object" ? value : {};
			return {
				enabled: typeof base.enabled === "boolean" ? base.enabled : true,
				toolDir: typeof base.toolDir === "string" ? base.toolDir : "",
				install: typeof base.install === "string" && base.install !== "" ? base.install : "auto",
				iconSet: typeof base.iconSet === "string" ? base.iconSet : "default",
				actionOnSave: typeof base.actionOnSave === "string" && base.actionOnSave !== "" ? base.actionOnSave : "none",
				taskbarAfter: typeof base.taskbarAfter === "boolean" ? base.taskbarAfter : false,
				roundIcons: typeof base.roundIcons === "boolean" ? base.roundIcons : true,
				hideSidebarBrand: typeof base.hideSidebarBrand === "boolean" ? base.hideSidebarBrand : false
			};
		}
		/**
		* The settings page body. Reads the Host entry's form through configForms,
		* stages edits locally and writes them back through controller.mutate.
		* @param props.form - the ConfigFormController bound to entry "dsh-icon-switch".
		* @param props.t - locale lookup bound to NS.
		*/
		function IconSwitchSection(props) {
			const form = props.form;
			const t = props.t;
			const [snap, setSnap] = react.useState(() => form.getSnapshot());
			const [draft, setDraft] = react.useState(() => normalizeValue(snap.value));
			const [busy, setBusy] = react.useState(false);
			const [failed, setFailed] = react.useState(false);
			const [applied, setApplied] = react.useState(false);
			const [taskbarMsg, setTaskbarMsg] = react.useState(null);
			react.useEffect(() => {
				const unsub = form.subscribe(() => setSnap(form.getSnapshot()));
				return typeof unsub === "function" ? unsub : void 0;
			}, [form]);
			const value = normalizeValue(snap.value);
			const available = snap.status === "ready";
			const ops = [];
			for (const [field] of FIELD_ROWS) {
				const current = value[field];
				const next = draft[field];
				if (typeof current === "boolean") {
					if (next !== current) ops.push({ op: "set", path: [field], value: next === true });
				} else if (typeof current === "string") {
					const s = typeof next === "string" ? next.trim() : "";
					if (s === "") {
						if (current !== "") ops.push({ op: "unset", path: [field] });
					} else if (s !== current) {
						ops.push({ op: "set", path: [field], value: s });
					}
				}
			}
			const dirty = ops.length > 0;
			const save = () => {
				if (!dirty || busy) return;
				setBusy(true);
				setFailed(false);
				form.mutate(ops, snap.revision)
					.then(() => { })
					.catch(() => setFailed(true))
					.finally(() => setBusy(false));
			};
			const discard = () => {
				if (busy) return;
				setDraft({ ...value });
				setFailed(false);
				setApplied(false);
			};
			const postAction = (body) => fetch("/api/dsh-icon-switch/action", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			}).then((res) => {
				if (!res.ok) throw new Error("status " + res.status);
				return res.json();
			});
			const applyNow = () => {
				if (busy) return;
				setBusy(true);
				setFailed(false);
				setApplied(false);
				setTaskbarMsg(null);
				postAction({
					action: "apply",
					install: draft.install || "auto",
					iconSet: draft.iconSet || "default",
					toolDir: draft.toolDir || void 0,
					taskbarAfter: draft.taskbarAfter === true,
					round: draft.roundIcons !== false
				}).then((data) => {
					setApplied(true);
					if (data && data.taskbar) setTaskbarMsg(data.taskbar.ok ? "taskbarOk" : "taskbarFail");
				}).catch(() => setFailed(true)).finally(() => setBusy(false));
			};
			// 只换运行中窗口的图标（任务栏/标题栏），不动文件、不需要重启
			const taskbarNow = () => {
				if (busy) return;
				setBusy(true);
				setFailed(false);
				setTaskbarMsg(null);
				postAction({
					action: "taskbar",
					install: draft.install || "auto",
					iconSet: draft.iconSet || "default"
				}).then(() => setTaskbarMsg("taskbarOk")).catch(() => setTaskbarMsg("taskbarFail")).finally(() => setBusy(false));
			};
			// -- icon gallery (preview) + upload -------------------------------
			const ICONS_API = "/api/dsh-icon-switch/icons";
			const PREVIEW_API = "/api/dsh-icon-switch/preview";
			const UPLOAD_API = "/api/dsh-icon-switch/upload";
			const [sets, setSets] = react.useState([]);
			const [uploading, setUploading] = react.useState(false);
			const [uploadMsg, setUploadMsg] = react.useState(null);
			const fileRef = react.useRef(null);
			const [uploadName, setUploadName] = react.useState("");
			react.useEffect(() => {
				let cancelled = false;
				fetch(ICONS_API)
					.then((res) => res.ok ? res.json() : Promise.reject(new Error("status " + res.status)))
					.then((data) => { if (!cancelled && data && Array.isArray(data.icons)) setSets(data.icons); })
					.catch(() => { /* gallery best-effort */ });
				return () => { cancelled = true; };
			}, []);
			const pickSet = (name) => {
				if (busy) return;
				setDraft((d) => ({ ...d, iconSet: name }));
			};
			const refreshSets = (after) => {
				fetch(ICONS_API)
					.then((res) => res.ok ? res.json() : Promise.reject(new Error("status " + res.status)))
					.then((data) => { if (data && Array.isArray(data.icons)) setSets(data.icons); })
					.catch(() => { })
					.finally(() => { if (typeof after === "function") after(); });
			};
			const doUpload = () => {
				const file = fileRef.current && fileRef.current.files && fileRef.current.files[0];
				if (!file || uploading || busy) return;
				setUploading(true);
				setUploadMsg(null);
				const reader = new FileReader();
				reader.onload = () => {
					const body = { name: uploadName.trim() || void 0, image: reader.result, round: draft.roundIcons !== false };
					fetch(UPLOAD_API, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					}).then((res) => res.json()).then((data) => {
						if (data && data.ok) {
							setUploadMsg({ ok: true, text: t("uploadOk") + (data.name ? `（${data.name}）` : "") });
							setDraft((d) => ({ ...d, iconSet: data.name }));
							if (fileRef.current) fileRef.current.value = "";
							setUploadName("");
							refreshSets();
						} else {
							setUploadMsg({ ok: false, text: (data && data.error) || t("uploadFail") });
						}
					}).catch(() => {
						setUploadMsg({ ok: false, text: t("uploadFail") });
					}).finally(() => setUploading(false));
				};
				reader.onerror = () => {
					setUploading(false);
					setUploadMsg({ ok: false, text: t("uploadFail") });
				};
				reader.readAsDataURL(file);
			};
			const fieldControl = (field, labelKey, hintKey, kind, options) => {
				const label = t(labelKey);
				const hint = t(hintKey);
				const disabled = busy || !available;
				const hintNode = hint !== label ? react.createElement("p", { className: cls.hint }, hint) : null;
				if (kind === "enum") {
					const value = typeof draft[field] === "string" && draft[field] !== "" ? draft[field] : (options?.[0] ?? "");
					return react.createElement("div", { key: field, className: cls.row },
						react.createElement("div", { className: cls.rowText },
							react.createElement("div", { className: cls.label },
								react.createElement("label", { htmlFor: "dsh-icon-switch-" + field }, label)),
							hintNode),
						react.createElement("span", { className: cls.control },
							react.createElement("select", {
								id: "dsh-icon-switch-" + field,
								className: cls.select,
								value,
								disabled,
								onChange: (e) => setDraft((d) => ({ ...d, [field]: e.target.value }))
							}, (options ?? []).map((opt) => react.createElement("option", { key: opt, value: opt }, opt)))));
				}
				if (kind === "bool") {
					return react.createElement("div", { key: field, className: cls.row },
						react.createElement("div", { className: cls.rowText },
							react.createElement("div", { className: cls.label }, label),
							hintNode),
						react.createElement("span", { className: cls.control },
							react.createElement(primitives.Switch, {
								checked: draft[field] === true,
								disabled,
								label,
								onChange: (next) => setDraft((d) => ({ ...d, [field]: next }))
							})));
				}
				return react.createElement("div", { key: field, className: cls.field },
					react.createElement("label", { className: cls.label, htmlFor: "dsh-icon-switch-" + field }, label),
					react.createElement(primitives.Input, {
						id: "dsh-icon-switch-" + field,
						className: cls.input,
						value: typeof draft[field] === "string" ? draft[field] : "",
						disabled,
						onChange: (e) => setDraft((d) => ({ ...d, [field]: e.target.value }))
					}),
					hintNode);
			};
			return react.createElement("div", { className: cls.section },
				react.createElement("h2", { className: cls.heading }, t("nav")),
				react.createElement("p", { className: cls.intro }, t("hint")),
				// -- icon gallery --------------------------------------------------
				react.createElement("div", { className: cls.block },
					react.createElement("h3", { className: cls.blockTitle }, t("galleryTitle")),
					react.createElement("p", { className: cls.blockHint }, t("galleryHint")),
					sets.length === 0
						? react.createElement("p", { className: cls.note }, t("unavailable"))
						: react.createElement("div", { className: cls.cards }, sets.map((s) => {
							const previewName = s.preview && /^[A-Za-z0-9@][A-Za-z0-9@._-]*$/.test(s.preview) ? s.preview : (s.files && s.files[0] && s.files[0].name || null);
							const selected = draft.iconSet === s.name;
							return react.createElement("button", {
								key: s.name,
								type: "button",
								className: cls.card,
								title: s.name,
								"aria-pressed": selected,
								disabled: busy || !available,
								onClick: () => pickSet(s.name)
							},
								react.createElement("span", { className: cls.thumb },
									previewName ? react.createElement("img", {
										src: PREVIEW_API + "?set=" + encodeURIComponent(s.name) + "&file=" + encodeURIComponent(previewName),
										alt: "",
										onError: (e) => { e.target.style.opacity = "0.25"; }
									}) : react.createElement("span", { className: cls.thumbFallback }, "🖼")),
								react.createElement("span", { className: cls.cardName }, s.name));
						}))),
				// -- upload --------------------------------------------------------
				react.createElement("div", { className: cls.block },
					react.createElement("h3", { className: cls.blockTitle }, t("uploadTitle")),
					react.createElement("p", { className: cls.blockHint }, t("uploadHint")),
					react.createElement("div", { className: cls.uploadRow },
						react.createElement("input", {
							ref: fileRef,
							type: "file",
							className: cls.file,
							accept: "image/png,image/jpeg,image/gif,image/bmp",
							disabled: uploading || busy
						}),
						react.createElement(primitives.Input, {
							className: cls.inputRow,
							type: "text",
							placeholder: t("uploadNamePlaceholder"),
							value: uploadName,
							disabled: uploading || busy,
							onChange: (e) => setUploadName(e.target.value)
						}),
						react.createElement(primitives.Button, {
							variant: "primary",
							size: "sm",
							onClick: doUpload,
							disabled: uploading || busy || !available
						}, uploading ? t("uploading") : t("uploadGenerate")),
						uploadMsg ? react.createElement("span", { className: uploadMsg.ok ? cls.noteOk : cls.noteFail }, uploadMsg.text) : null)),
				// -- settings form -------------------------------------------------
				react.createElement(primitives.SettingsForm, {
					state: { available, writable: available, dirty, invalid: false, saving: busy, failed },
					labels: {
						unavailable: t("unavailable"),
						readOnly: t("readOnly"),
						saveFailed: t("saveFailed"),
						save: t("save"),
						saving: t("saving")
					},
					onSave: save,
					onDiscard: discard,
					children: react.createElement("div", { className: cls.rows },
						FIELD_ROWS.map((row) => fieldControl(row[0], row[1], row[2], row[3], row[4])))
				}),
				react.createElement("div", { className: cls.actions },
					react.createElement(primitives.Button, {
						variant: "primary",
						onClick: applyNow,
						disabled: busy || !available
					}, t("applyNow")),
					react.createElement(primitives.Button, {
						variant: "outline",
						onClick: taskbarNow,
						disabled: busy || !available
					}, t("taskbarNow")),
					applied ? react.createElement("span", { className: cls.noteOk }, t("applied")) : null,
					taskbarMsg ? react.createElement("span", { className: taskbarMsg === "taskbarOk" ? cls.noteOk : cls.noteFail }, t(taskbarMsg)) : null));
		}
		//#endregion
		/** Contribute the section to the Web Settings side nav. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-icon-switch: dictionaries");
			// -- sidebar brand row: one stylesheet, live on config change --------
			ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NS], () => {
				const form = ctx.configForms.get(SETTINGS_NS);
				const tag = document.createElement("style");
				tag.setAttribute("data-dsh-icon-switch", "hide-sidebar-brand");
				tag.textContent = HIDE_BRAND_CSS;
				const sync = () => {
					let want = false;
					try {
						want = normalizeValue(form.getSnapshot().value).hideSidebarBrand === true;
					} catch {
						want = false;
					}
					if (want === tag.isConnected) return;
					if (want) document.head.appendChild(tag);
					else tag.remove();
				};
				sync();
				let unsubscribe;
				try {
					unsubscribe = form.subscribe(sync);
				} catch { /* the last known state stays applied */ }
				return () => {
					try {
						if (typeof unsubscribe === "function") unsubscribe();
					} catch { /* ignore */ }
					tag.remove();
				};
			}), "dsh-icon-switch: hide sidebar brand");
			const t = ctx.locale.bind(NS);
			const injected = () => ({
				form: ctx.configForms.get(SETTINGS_NS),
				t
			});
			ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NS], () => ctx.slots.inject(
				"settings.section",
				() => ctx.slots.register({
					name: "settings.section",
					id: "dsh-icon-switch",
					order: 60,
					label: () => t("nav"),
					locale: NS,
					inject: injected
				}, IconSwitchSection)
			)), "dsh-icon-switch: settings section");
		}
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map