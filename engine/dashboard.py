"""
Dashboard generator — dashboard.html avec toutes les candidatures.
Lance via : python main.py dashboard
"""

import json
import unicodedata
from pathlib import Path
from datetime import datetime


def _slugify(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text.lower())
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    return ascii_str.replace(" ", "-")


def generate(jobs: list, applications_dir: Path, output_path: Path):

    app_folders = sorted(f for f in applications_dir.glob("*/") if f.is_dir()) if applications_dir.exists() else []

    # ── Enrichit chaque dossier avec CV path + lettre text ──────────────────
    folder_docs = {}   # key = "company|title" → {cv_path, letter_text}
    modal_data  = []

    for folder in app_folders:
        parts = folder.name.split("_", 2)
        info_file = folder / "job_info.json"

        if info_file.exists():
            try:
                info     = json.loads(info_file.read_text(encoding="utf-8"))
                job_data = info.get("job", {})
                company  = job_data.get("company", "")
                title    = job_data.get("title", "")
            except Exception:
                company, title = "", ""
        else:
            company = parts[1].replace("-", " ").title() if len(parts) > 1 else ""
            title   = parts[2].replace("-", " ").title() if len(parts) > 2 else ""

        if not company:
            continue

        # CV : préfixe CV_ (offres classiques) ou *_CV_Gregoire_Linee.pdf (spontanées)
        cv_files = (list(folder.glob("CV_*.pdf"))
                    or list(folder.glob("*_CV_Gregoire_Linee.pdf"))
                    or list(folder.glob("cv_gregoire_linee.pdf"))
                    or list(folder.glob("CV_*.docx"))
                    or list(folder.glob("*.pdf")))
        cv_rel   = f"applications/{folder.name}/{cv_files[0].name}" if cv_files else ""

        # Lettre : txt uniquement (lisible)
        txt_files    = list(folder.glob("LettreMotivation_*.txt"))
        letter_text  = ""
        if txt_files:
            try:
                letter_text = txt_files[0].read_text(encoding="utf-8").strip()
            except Exception:
                pass

        # Statut autofill (écrit par scrapers/autofill.py dans job_info.json)
        autofill_info = {}
        if info_file.exists():
            try:
                full_info = json.loads(info_file.read_text(encoding="utf-8"))
                autofill_info = full_info.get("autofill", {})
            except Exception:
                pass

        key = f"{company.lower()}|{title.lower()}"
        folder_docs[key] = {
            "cv_rel":      cv_rel,
            "letter_text": letter_text,
            "folder":      folder.name,
            "autofill":    autofill_info,
        }

        if letter_text:
            card_id = f"card-{len(modal_data)}"
            modal_data.append({
                "id":     card_id,
                "key":    key,
                "label":  f"{company} — {title}",
                "letter": letter_text,
                "cv":     cv_rel,
            })

    # ── Ajoute les jobs depuis applications/ absents de jobs.json ───────────
    existing_keys = {
        f"{j.get('company','').lower()}|{j.get('title','').lower()}"
        for j in jobs
    }
    synthetic_idx = max((j.get("_idx", 0) for j in jobs), default=0)

    for folder in app_folders:
        parts     = folder.name.split("_", 2)
        info_file = folder / "job_info.json"

        if info_file.exists():
            try:
                info     = json.loads(info_file.read_text(encoding="utf-8"))
                job_data = info.get("job", {})
                company  = job_data.get("company", "")
                title    = job_data.get("title", "")
                url      = job_data.get("url", "")
                platform = job_data.get("platform", "")
                fit_score = info.get("fit_score")
                analysis  = {
                    "role_summary":   info.get("role_summary", ""),
                    "why_interesting": info.get("why_interesting", ""),
                }
            except Exception:
                company, title, url, platform, fit_score, analysis = "", "", "", "", None, {}
        else:
            company  = parts[1].replace("-", " ").title() if len(parts) > 1 else ""
            title    = parts[2].replace("-", " ").title() if len(parts) > 2 else ""
            url, platform, fit_score, analysis = "", "", None, {}

        # Détecte les candidatures spontanées (pas de job_info.json → resume.txt)
        resume_file = folder / "resume.txt"
        is_spontaneous = not info_file.exists() and resume_file.exists()
        if is_spontaneous:
            if not platform:
                platform = "wttj-spontaneous"
            # Extrait l'URL WTTJ et le score depuis resume.txt si url vide
            if not url and resume_file.exists():
                try:
                    resume_txt = resume_file.read_text(encoding="utf-8")
                    for line in resume_txt.splitlines():
                        if line.startswith("URL WTTJ"):
                            extracted = line.split(":", 1)[-1].strip()
                            if extracted.startswith("http"):
                                # S'assure que l'URL pointe directement sur les offres
                                if not extracted.rstrip("/").endswith("/jobs"):
                                    extracted = extracted.rstrip("/") + "/jobs"
                                url = extracted
                        if fit_score is None and line.startswith("Score fit"):
                            raw_score = line.split(":", 1)[-1].strip().split("/")[0].strip()
                            try:
                                fit_score = int(raw_score)
                            except ValueError:
                                pass
                except Exception:
                    pass

        key = f"{company.lower()}|{title.lower()}"
        if key not in existing_keys and company:
            synthetic_idx += 1
            jobs = list(jobs) + [{
                "_idx":       synthetic_idx,
                "company":    company,
                "title":      title,
                "url":        url,
                "platform":   platform,
                "_fit_score": fit_score,
                "_analysis":  analysis,
                "_from_folder": folder.name,
            }]
            existing_keys.add(key)

    # ── Charge l'état persisté (ticks + suppressions) ────────────────────────
    state_file = output_path.parent / "user_state.json"
    baked_state = {"applied": {}, "deleted": []}
    if state_file.exists():
        try:
            baked_state = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    if not isinstance(baked_state.get("applied"), dict):
        baked_state["applied"] = {}
    if not isinstance(baked_state.get("deleted"), list):
        baked_state["deleted"] = []
    if not isinstance(baked_state.get("auto_failed"), dict):
        baked_state["auto_failed"] = {}
    baked_state_js = json.dumps(baked_state, ensure_ascii=False)

    # ── Stats ────────────────────────────────────────────────────────────────
    total        = len(jobs)
    analyzed     = sum(1 for j in jobs if isinstance(j.get("_fit_score"), int))
    avg_score    = round(
        sum(j.get("_fit_score", 0) for j in jobs if isinstance(j.get("_fit_score"), int))
        / max(analyzed, 1), 1
    )
    docs_count   = len(app_folders)
    generated_at = datetime.now().strftime("%d/%m/%Y à %H:%M")

    # ── Modal map (key → card_id) pour lookup depuis la table ───────────────
    key_to_modal = {d["key"]: d["id"] for d in modal_data}

    # ── Rows ─────────────────────────────────────────────────────────────────
    rows = []
    for job in sorted(jobs, key=lambda x: (1 if x.get("_from_folder") else 0, x.get("_fit_score") or 0), reverse=True):
        score    = job.get("_fit_score", "–")
        company  = job.get("company", "–")
        title    = job.get("title", "–")
        platform = job.get("platform", "–")
        url      = job.get("url", "")
        idx      = job.get("_idx", "")
        job_id   = f"{company}|{title}".replace("'", "").replace('"', "")

        key = f"{company.lower()}|{title.lower()}"
        docs = folder_docs.get(key, {})
        cv_rel      = docs.get("cv_rel", "")
        letter_text = docs.get("letter_text", "")
        card_id     = key_to_modal.get(key, "")
        has_docs    = bool(cv_rel or letter_text)
        autofill    = docs.get("autofill", {})
        af_done     = autofill.get("done", False)
        af_skipped  = autofill.get("skipped", False)
        af_fields   = autofill.get("fields_filled", 0)
        af_at       = autofill.get("at", "")

        # Badge fit score
        if isinstance(score, int) and score >= 8:
            badge = f'<span class="badge bg">{score}/10</span>'
        elif isinstance(score, int) and score >= 6:
            badge = f'<span class="badge my">{score}/10</span>'
        elif isinstance(score, int):
            badge = f'<span class="badge rd">{score}/10</span>'
        else:
            badge = '<span class="badge gy">–</span>'

        # Actions groupées
        action_parts = []
        if url:
            action_parts.append(f'<a class="act-btn act-link" href="{url}" target="_blank">Voir ↗</a>')
        if cv_rel:
            cv_label = "PDF" if cv_rel.endswith(".pdf") else "CV"
            action_parts.append(f'<a class="act-btn act-dl" href="{cv_rel}" download>⬇ {cv_label}</a>')
        if card_id:
            action_parts.append(f'<button class="act-btn act-copy" onclick="openModal(\'{card_id}\');event.stopPropagation()">📋 Lettre</button>')

        actions_html = '<div class="actions">' + "".join(action_parts) + '</div>' if action_parts else '<span class="muted">–</span>'

        # Analyse détail
        analysis     = job.get("_analysis", {})
        role_summary = analysis.get("role_summary", "") if isinstance(analysis, dict) else ""
        why          = analysis.get("why_interesting", "") if isinstance(analysis, dict) else ""
        detail_html  = ""
        if role_summary:
            detail_html += f'<p><strong>Résumé :</strong> {role_summary}</p>'
        if why:
            detail_html += f'<p><strong>Pourquoi intéressant :</strong> {why}</p>'
        if not detail_html:
            detail_html = '<p class="muted">Pas encore analysé</p>'

        # Badge plateforme
        plat_lower = platform.lower() if platform else ""
        if "linkedin" in plat_lower:
            plat_badge = '<span class="plat-badge plat-li">in LinkedIn</span>'
            row_plat   = "row-linkedin"
        elif "spontaneous" in plat_lower:
            plat_badge = '<span class="plat-badge plat-spon">✦ Spontanée</span>'
            row_plat   = "row-spon"
        elif "wttj" in plat_lower:
            plat_badge = '<span class="plat-badge plat-wttj">🌿 WTTJ</span>'
            row_plat   = "row-wttj"
        else:
            plat_badge = ""
            row_plat   = ""

        # Badge autofill
        if af_done:
            af_title = f"🤖 Autofill OK — {af_fields} champ(s) remplis le {af_at}"
            autofill_badge = f'<span class="af-badge af-done" title="{af_title}">🤖 Rempli</span>'
        elif af_skipped:
            autofill_badge = '<span class="af-badge af-skip" title="Création de compte requise">⛔ Compte requis</span>'
        else:
            autofill_badge = ''

        low = isinstance(score, int) and score < 6
        rows.append(f"""
        <tr class="job-row {row_plat}{"  low-score" if low else ""}" data-score="{score if isinstance(score, int) else 0}" data-id="{job_id}" data-url="{url}" data-hasdocs="{str(has_docs).lower()}" data-platform="{plat_lower}" data-autofilled="{str(af_done).lower()}">
          <td class="idx">{idx}</td>
          <td><strong>{company}</strong><br>{plat_badge}{autofill_badge}</td>
          <td class="col-title">{title}</td>
          <td>{badge}</td>
          <td onclick="event.stopPropagation()">{actions_html}</td>
          <td onclick="event.stopPropagation()" class="submit-cell">
            <label class="submit-wrap" title="Cocher dès que tu as cliqué Submit">
              <input type="checkbox" class="postule-cb" data-id="{job_id}" onchange="saveCheck(this)">
              <span class="submit-btn">✅ Soumis</span>
            </label>
            <span class="auto-fail-marker" data-id="{job_id}" style="display:none"></span>
          </td>
          <td onclick="event.stopPropagation()">
            <button class="act-btn act-del" title="Supprimer cette ligne" onclick="deleteRow(this)">✕</button>
          </td>
        </tr>
        <tr class="detail-row" style="display:none">
          <td colspan="6" class="detail-cell">
            <div class="detail-content">{detail_html}</div>
          </td>
        </tr>
        """)

    rows_html = "\n".join(rows)

    # ── Modal data JS ────────────────────────────────────────────────────────
    modal_data_js = json.dumps(modal_data, ensure_ascii=False)

    # ════════════════════════════════════════════════════════════════════════
    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Job Apply — Dashboard</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;background:#f7f7f5;color:#1a1a1a;min-height:100vh;font-size:14px}}
.header{{background:#fff;padding:20px 40px;border-bottom:1px solid #e8e8e5;display:flex;align-items:center;justify-content:space-between}}
.header h1{{font-size:18px;font-weight:600;color:#1a1a1a;letter-spacing:-.3px}}
.header h1 span{{color:#6b7280}}
.header p{{color:#9ca3af;font-size:12px;margin-top:2px}}
.stats{{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:16px 40px}}
.stat-card{{background:#fff;border:1px solid #e8e8e5;border-radius:8px;padding:14px 16px}}
.stat-value{{font-size:24px;font-weight:600;color:#1a1a1a}}
.stat-label{{font-size:11px;color:#9ca3af;margin-top:2px;text-transform:uppercase;letter-spacing:.4px}}
.postule-count{{font-size:24px;font-weight:600;color:#16a34a}}
.section{{padding:0 40px 24px}}
.section-header{{display:flex;align-items:center;justify-content:space-between;padding-top:18px;margin-bottom:10px}}
.section-title{{font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px}}
.section-count{{font-size:11px;color:#9ca3af;margin-left:6px}}
.filters{{display:flex;gap:6px;flex-wrap:wrap;align-items:center}}
.filter-btn{{padding:3px 10px;border-radius:5px;border:1px solid #e8e8e5;background:#fff;color:#6b7280;font-size:11px;cursor:pointer;transition:all .12s;font-family:inherit}}
.filter-btn:hover{{background:#f3f4f6;color:#1a1a1a}}
.filter-btn.active{{background:#1a1a1a;color:#fff;border-color:#1a1a1a}}
.search{{padding:6px 11px;background:#fff;border:1px solid #e8e8e5;border-radius:6px;color:#1a1a1a;font-size:13px;outline:none;width:220px;font-family:inherit}}
.search:focus{{border-color:#9ca3af}}
.search::placeholder{{color:#d1d5db}}
.table-wrap{{background:#fff;border:1px solid #e8e8e5;border-radius:8px;overflow:hidden}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
thead th{{background:#fafafa;padding:8px 14px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#9ca3af;font-weight:600;border-bottom:1px solid #e8e8e5}}
.job-row td{{padding:9px 14px;border-top:1px solid #f3f4f6;vertical-align:middle;cursor:pointer}}
.job-row:hover td{{background:#fafafa}}
.job-row.done td{{background:#f0fdf4}}
.job-row.done:hover td{{background:#dcfce7}}
.job-row.done td strong{{color:#16a34a}}
.job-row.done .col-title{{color:#86efac}}
.job-row.low-score td{{opacity:.4}}
.job-row.low-score:hover td{{opacity:.6}}
.detail-cell{{padding:0!important}}
.detail-content{{padding:10px 16px;background:#fafafa;font-size:12px;color:#6b7280;border-top:1px solid #f3f4f6}}
.detail-content p{{margin-bottom:3px}}.detail-content strong{{color:#374151}}
.muted{{color:#9ca3af;font-style:italic;font-size:11px}}
.idx{{color:#d1d5db;width:32px;font-size:11px;font-weight:500}}
.col-title{{color:#6b7280;max-width:200px;font-size:12px}}
.badge{{padding:2px 7px;border-radius:4px;font-size:11px;font-weight:500}}
.bg{{background:#dcfce7;color:#15803d}}.my{{background:#fef9c3;color:#92400e}}
.rd{{background:#fee2e2;color:#dc2626}}.gy{{background:#f3f4f6;color:#9ca3af}}
.plat-badge{{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:500;margin-top:2px}}
.plat-li{{background:#eff6ff;color:#2563eb}}
.plat-wttj{{background:#f0fdf4;color:#15803d}}
.af-badge{{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:500;margin-top:3px;margin-left:3px}}
.af-done{{background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0}}
.af-skip{{background:#fff7ed;color:#c2410c;border:1px solid #fed7aa}}
.submit-cell{{min-width:90px}}
.submit-wrap{{display:inline-flex;align-items:center;gap:0;cursor:pointer;user-select:none}}
.submit-wrap input[type=checkbox]{{display:none}}
.submit-btn{{padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;background:#f3f4f6;color:#9ca3af;border:1.5px solid #e5e7eb;cursor:pointer;transition:all .15s;white-space:nowrap}}
.submit-wrap input:checked + .submit-btn{{background:#dcfce7;color:#16a34a;border-color:#86efac}}
.submit-wrap:hover .submit-btn{{border-color:#d1d5db;color:#6b7280}}
.plat-spon{{background:#faf5ff;color:#7c3aed}}
.row-linkedin td:first-child{{border-left:2px solid #93c5fd}}
.row-wttj td:first-child{{border-left:2px solid #86efac}}
.row-spon td:first-child{{border-left:2px solid #d8b4fe}}
.actions{{display:flex;gap:4px;flex-wrap:nowrap;align-items:center}}
.act-btn{{padding:3px 8px;border-radius:5px;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;text-decoration:none;border:1px solid #e8e8e5;background:#fff;color:#6b7280;transition:all .1s;display:inline-flex;align-items:center;font-family:inherit}}
.act-btn:hover{{background:#f3f4f6;color:#1a1a1a}}
.act-link{{color:#2563eb;border-color:#bfdbfe;background:#eff6ff}}.act-link:hover{{background:#dbeafe}}
.act-dl{{color:#059669;border-color:#a7f3d0;background:#f0fdf4}}.act-dl:hover{{background:#dcfce7}}
.act-copy{{color:#7c3aed;border-color:#ddd6fe;background:#faf5ff}}.act-copy:hover{{background:#ede9fe}}
.act-del{{color:#dc2626;border-color:#fecaca;background:#fff5f5;padding:3px 6px}}.act-del:hover{{background:#fee2e2}}
/* check-wrap legacy (conservé pour compat) */
.check-wrap{{display:inline-flex;align-items:center;cursor:pointer;user-select:none}}
.check-wrap input{{display:none}}
.checkmark{{width:16px;height:16px;border:1.5px solid #d1d5db;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;transition:all .12s;flex-shrink:0}}
.postule-cb:checked + .checkmark{{background:#16a34a;border-color:#16a34a}}
.postule-cb:checked + .checkmark::after{{content:'✓';font-size:10px;color:#fff;font-weight:700}}
.postule-cb.auto-applied:checked + .checkmark{{background:#7c3aed;border-color:#7c3aed}}
.check-wrap[data-when]{{position:relative}}
/* Marqueur d'échec auto-apply */
.auto-fail-marker{{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#fb923c;color:#fff;font-size:11px;font-weight:700;margin-left:6px;cursor:help;position:relative;border:1.5px solid #ea580c;vertical-align:middle}}
.auto-fail-marker::after{{content:'⚠';font-size:10px}}
.auto-fail-marker:hover .auto-fail-tooltip{{display:block}}
.auto-fail-tooltip{{display:none;position:absolute;top:24px;right:0;background:#1f2937;color:#fff;font-size:11px;padding:8px 10px;border-radius:6px;width:300px;z-index:100;text-align:left;font-weight:400;box-shadow:0 4px 12px rgba(0,0,0,.25);line-height:1.4}}
.auto-fail-tooltip strong{{color:#fb923c;display:block;margin-bottom:4px;font-size:10px;text-transform:uppercase;letter-spacing:.5px}}
.auto-fail-tooltip a{{color:#60a5fa;text-decoration:underline;display:inline-block;margin-top:6px;font-size:11px}}
.auto-fail-tooltip .at{{color:#9ca3af;font-size:10px;margin-top:4px;display:block}}
.modal-overlay{{display:none;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1000;align-items:center;justify-content:center}}
.modal-overlay.open{{display:flex}}
.modal{{background:#fff;border:1px solid #e8e8e5;border-radius:10px;width:680px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}}
.modal-header{{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #f3f4f6}}
.modal-title{{font-size:13px;font-weight:600;color:#1a1a1a}}
.modal-close{{background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;line-height:1;padding:2px 6px;border-radius:4px}}
.modal-close:hover{{color:#1a1a1a;background:#f3f4f6}}
.modal-body{{padding:14px 18px;overflow-y:auto;flex:1}}
.modal-letter{{background:#fafafa;border:1px solid #f3f4f6;border-radius:6px;padding:14px;font-size:13px;color:#374151;line-height:1.8;white-space:pre-wrap;word-break:break-word;font-family:Georgia,serif}}
.modal-footer{{padding:10px 18px;border-top:1px solid #f3f4f6;display:flex;gap:8px;align-items:center}}
.modal-copy-btn{{background:#1a1a1a;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:background .12s;font-family:inherit}}
.modal-copy-btn:hover{{background:#374151}}.modal-copy-btn.copied{{background:#16a34a}}
.modal-pdf-btn{{background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit}}
.modal-pdf-btn:hover{{background:#dcfce7}}
.modal-dl-btn{{background:#fafafa;color:#374151;border:1px solid #e8e8e5;border-radius:6px;padding:7px 14px;font-size:12px;text-decoration:none;font-weight:500}}
.modal-dl-btn:hover{{background:#f3f4f6}}
.footer{{padding:14px 40px;color:#9ca3af;font-size:11px;border-top:1px solid #e8e8e5;margin-top:4px}}
.empty-state{{color:#9ca3af;font-size:13px;padding:32px;text-align:center}}
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>🚀 Job Apply <span>Dashboard</span></h1>
    <p>Mis à jour le {generated_at} · Gregoire Linée</p>
  </div>
</div>

<div class="stats">
  <div class="stat-card"><div class="stat-value">{total}</div><div class="stat-label">Offres scrapées</div></div>
  <div class="stat-card"><div class="stat-value">{analyzed}</div><div class="stat-label">Analysées</div></div>
  <div class="stat-card"><div class="stat-value">{avg_score}</div><div class="stat-label">Score moyen</div></div>
  <div class="stat-card"><div class="stat-value">{docs_count}</div><div class="stat-label">Docs générés</div></div>
  <div class="stat-card"><div class="postule-count" id="postule-stat">0</div><div class="stat-label">✅ Postulé</div></div>
</div>

<!-- ── Table principale : offres à traiter ── -->
<div class="section">
  <div class="section-header">
    <div style="display:flex;align-items:center;gap:12px">
      <span class="section-title">📋 Offres à envoyer</span>
      <span class="section-count" id="pending-count"></span>
    </div>
    <div class="filters">
      <input class="search" type="text" id="search" placeholder="Rechercher..." oninput="applyFilters()">
      <button class="filter-btn active" onclick="setFilter('all',this)">Toutes</button>
      <button class="filter-btn" onclick="setFilter('score8',this)">🔥 ≥ 8</button>
      <button class="filter-btn" onclick="setFilter('score6',this)">✅ ≥ 6</button>
      <button class="filter-btn" onclick="setFilter('docs',this)">📄 Docs</button>
      <button class="filter-btn" onclick="setFilter('postule',this)">✅ Postulé</button>
      <button class="filter-btn" onclick="setFilter('notpostule',this)">⏳ À envoyer</button>
      <button class="filter-btn" style="color:#0ea5e9;border-color:#0369a1" onclick="setFilter('linkedin',this)">in LinkedIn</button>
      <button class="filter-btn" style="color:#34d399;border-color:#065f46" onclick="setFilter('wttj',this)">🌿 WTTJ</button>
      <button class="filter-btn" style="color:#c084fc;border-color:#7c3aed" onclick="setFilter('spon',this)">✦ Spontanées</button>
    </div>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th><th>Entreprise</th><th>Poste</th><th>Fit</th><th>Actions</th><th>✓</th><th></th>
        </tr>
      </thead>
      <tbody id="jobs-body">{rows_html}</tbody>
    </table>
    <div class="empty-state" id="empty-state" style="display:none">Aucune offre à afficher.</div>
  </div>
</div>

<!-- ── Modal lettre ── -->
<div class="modal-overlay" id="modal-overlay" onclick="closeModal(event)">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title" id="modal-title">Lettre de motivation</span>
      <button class="modal-close" onclick="closeModalDirect()">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-letter" id="modal-letter-text"></div>
    </div>
    <div class="modal-footer">
      <button class="modal-copy-btn" id="modal-copy-btn" onclick="copyLetter()">📋 Copier le texte</button>
      <button class="modal-pdf-btn" id="modal-pdf-btn" onclick="downloadLetterPDF()">⬇ Lettre PDF</button>
      <a class="modal-dl-btn" id="modal-dl-btn" href="#" download style="display:none">⬇ CV</a>
    </div>
  </div>
</div>

<div class="footer">Job Apply · python main.py dashboard · Gregoire Linée</div>

<script>
  const STATE_URL = 'http://127.0.0.1:7433/state';
  let currentFilter = 'all';

  // ── État embarqué à la génération (source de vérité principale) ──
  const BAKED_STATE = {baked_state_js};
  let _state = JSON.parse(JSON.stringify(BAKED_STATE));

  // ── Données lettres ──
  const MODAL_DATA = {modal_data_js};
  const modalMap = {{}};
  MODAL_DATA.forEach(d => {{ modalMap[d.id] = d; }});

  // ── Sauvegarde vers serveur + localStorage ──
  async function saveState() {{
    localStorage.setItem('jobapply_state', JSON.stringify(_state));
    try {{ await fetch(STATE_URL, {{method:'POST', headers:{{'Content-Type':'application/json'}}, body:JSON.stringify(_state)}}); }} catch(e) {{}}
  }}

  // ── Init ──
  async function init() {{
    // Charge localStorage en premier (historique potentiellement plus complet)
    let lsState = {{}};
    try {{
      const ls = JSON.parse(localStorage.getItem('jobapply_state') || 'null');
      if (ls && typeof ls === 'object') lsState = ls;
    }} catch(e) {{}}

    try {{
      const r = await fetch(STATE_URL, {{cache:'no-store'}});
      if (r.ok) {{
        const srv = await r.json();
        if (srv && typeof srv === 'object') {{
          // Merge : union de localStorage + serveur (localStorage peut avoir des ticks
          // cochés quand le serveur était éteint — on ne veut pas les perdre)
          const mergedApplied = Object.assign({{}}, lsState.applied || {{}}, srv.applied || {{}});
          const srvDel = srv.deleted || [];
          const lsDel  = lsState.deleted || [];
          const mergedDeleted = [...new Set([...srvDel, ...lsDel])];
          _state = {{ applied: mergedApplied, deleted: mergedDeleted }};
          // Resauve immédiatement le merge au serveur pour que user_state.json soit complet
          try {{ await fetch(STATE_URL, {{method:'POST', headers:{{'Content-Type':'application/json'}}, body:JSON.stringify(_state)}}); }} catch(e) {{}}
        }}
      }}
    }} catch(e) {{
      // Serveur absent → localStorage seul
      if (lsState && typeof lsState === 'object') {{
        _state = {{ applied: lsState.applied || {{}}, deleted: lsState.deleted || [] }};
      }}
    }}

    if (!_state.applied) _state.applied = {{}};
    if (!_state.deleted) _state.deleted = [];

    // Cache les lignes supprimées
    _state.deleted.forEach(id => {{
      document.querySelectorAll('tr.job-row').forEach(row => {{
        if (row.dataset.id === id) {{
          const det = row.nextElementSibling;
          if (det?.classList.contains('detail-row')) det.remove();
          row.remove();
        }}
      }});
    }});
    // Coche les postulés (auto vs manuel)
    document.querySelectorAll('.postule-cb').forEach(cb => {{
      const val = _state.applied[cb.dataset.id];
      if (!val) return;
      cb.checked = true;
      cb.closest('tr').classList.add('done');
      // Auto-soumission : objet avec {{auto:true, submitted_at:...}}
      if (typeof val === 'object' && val.auto) {{
        cb.classList.add('auto-applied');
        const wrap = cb.closest('.check-wrap');
        if (wrap && val.submitted_at) {{
          // Format lisible : "05/05 14:32 (auto)"
          const d = new Date(val.submitted_at);
          if (!isNaN(d)) {{
            const fmt = d.toLocaleString('fr-FR', {{
              day:'2-digit', month:'2-digit',
              hour:'2-digit', minute:'2-digit'
            }});
            wrap.setAttribute('data-when', '⚡ Auto · ' + fmt);
          }} else {{
            wrap.setAttribute('data-when', '⚡ Soumise auto');
          }}
        }}
      }}
    }});
    // Marqueurs d'échec auto-apply (orange)
    const autoFailed = _state.auto_failed || {{}};
    document.querySelectorAll('.auto-fail-marker').forEach(marker => {{
      const id = marker.dataset.id;
      const fail = autoFailed[id];
      if (!fail) return;
      // Si la candidature a entre-temps été cochée comme soumise, n'affiche pas l'échec
      if (_state.applied[id]) return;
      marker.style.display = 'inline-flex';
      const tooltip = document.createElement('span');
      tooltip.className = 'auto-fail-tooltip';
      let when = '';
      if (fail.at) {{
        const d = new Date(fail.at);
        if (!isNaN(d)) {{
          when = d.toLocaleString('fr-FR', {{
            day:'2-digit', month:'2-digit',
            hour:'2-digit', minute:'2-digit'
          }});
        }}
      }}
      const reasonEsc = (fail.reason || 'Échec auto-apply')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      tooltip.innerHTML =
        '<strong>⚠ Auto-apply échoué</strong>' +
        reasonEsc +
        (fail.screenshot ? '<br><a href="/' + fail.screenshot + '" target="_blank">📸 Voir screenshot</a>' : '') +
        (when ? '<span class="at">' + when + '</span>' : '');
      marker.appendChild(tooltip);
    }});
    updateStat();
    applyFilters();
  }}

  // ── Sauvegarde une coche (manuelle) ──
  async function saveCheck(cb) {{
    if (!_state.applied) _state.applied = {{}};
    const id = cb.dataset.id;
    if (cb.checked) {{
      _state.applied[id] = true;
      cb.closest('tr').classList.add('done');
    }} else {{
      delete _state.applied[id];
      cb.closest('tr').classList.remove('done');
      cb.classList.remove('auto-applied');
      const wrap = cb.closest('.check-wrap');
      if (wrap) wrap.removeAttribute('data-when');
    }}
    await saveState();
    updateStat();
    applyFilters();
  }}

  function updateStat() {{
    const count = document.querySelectorAll('.postule-cb:checked').length;
    document.getElementById('postule-stat').textContent = count;
  }}

  // ── Filtres ──
  function setFilter(f, btn) {{
    currentFilter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFilters();
  }}

  function applyFilters() {{
    const query = document.getElementById('search').value.toLowerCase();
    let visible = 0;
    document.querySelectorAll('#jobs-body .job-row').forEach(row => {{
      const score   = parseInt(row.dataset.score) || 0;
      const text    = row.textContent.toLowerCase();
      const hasDocs = row.dataset.hasdocs === 'true';
      const posted  = row.querySelector('.postule-cb')?.checked || false;

      const platform = row.dataset.platform || '';
      const filterOk = (
        currentFilter === 'all'       ? true :
        currentFilter === 'score8'    ? score >= 8 :
        currentFilter === 'score6'    ? score >= 6 :
        currentFilter === 'docs'      ? hasDocs :
        currentFilter === 'postule'   ? posted :
        currentFilter === 'notpostule'? !posted :
        currentFilter === 'linkedin'  ? platform.includes('linkedin') :
        currentFilter === 'wttj'      ? (platform.includes('wttj') && !platform.includes('spontaneous')) :
        currentFilter === 'spon'      ? platform.includes('spontaneous') : true
      );
      const searchOk = !query || text.includes(query);
      const show = filterOk && searchOk;

      row.style.display = show ? '' : 'none';
      const detail = row.nextElementSibling;
      if (detail?.classList.contains('detail-row') && !show) detail.style.display = 'none';
      if (show) visible++;
    }});

    document.getElementById('pending-count').textContent = visible > 0 ? `${{visible}} offre${{visible > 1 ? 's' : ''}}` : '';
    document.getElementById('empty-state').style.display = visible === 0 ? '' : 'none';
  }}

  // ── Toggle détail au clic sur une ligne ──
  document.addEventListener('click', e => {{
    const row = e.target.closest('.job-row');
    if (!row) return;
    const detail = row.nextElementSibling;
    if (detail && detail.classList.contains('detail-row')) {{
      detail.style.display = detail.style.display === 'none' ? 'table-row' : 'none';
    }}
  }});

  // ── Modal ──
  function openModal(cardId) {{
    const d = modalMap[cardId];
    if (!d) return;
    document.getElementById('modal-title').textContent = d.label;
    document.getElementById('modal-letter-text').textContent = d.letter;
    const dlBtn = document.getElementById('modal-dl-btn');
    if (d.cv) {{ dlBtn.href = d.cv; dlBtn.style.display = ''; }}
    else dlBtn.style.display = 'none';
    document.getElementById('modal-copy-btn').textContent = '📋 Copier le texte';
    document.getElementById('modal-copy-btn').classList.remove('copied');
    document.getElementById('modal-overlay').classList.add('open');
  }}

  function closeModal(e) {{
    if (e.target === document.getElementById('modal-overlay')) closeModalDirect();
  }}
  function closeModalDirect() {{
    document.getElementById('modal-overlay').classList.remove('open');
  }}
  document.addEventListener('keydown', e => {{ if (e.key === 'Escape') closeModalDirect(); }});

  function copyLetter() {{
    const text = document.getElementById('modal-letter-text').textContent;
    navigator.clipboard.writeText(text).then(() => {{
      const btn = document.getElementById('modal-copy-btn');
      btn.textContent = '✅ Copié !';
      btn.classList.add('copied');
      setTimeout(() => {{ btn.textContent = '📋 Copier le texte'; btn.classList.remove('copied'); }}, 2500);
    }});
  }}


  async function deleteRow(btn) {{
    const row = btn.closest('tr');
    if (!row) return;
    const jobId = row.dataset.id || '';
    const jobUrl = row.dataset.url || '';
    const detail = row.nextElementSibling;
    if (detail && detail.classList.contains('detail-row')) detail.remove();
    row.remove();
    // Persiste la suppression
    if (jobId) {{
      if (!_state.deleted) _state.deleted = [];
      if (!_state.deleted.includes(jobId)) _state.deleted.push(jobId);
      await saveState();
    }}
    // Blackliste l'URL dans seen.json pour ne plus la scraper
    if (jobUrl) {{
      try {{
        await fetch('http://127.0.0.1:7433/blacklist', {{
          method: 'POST',
          headers: {{'Content-Type': 'application/json'}},
          body: JSON.stringify({{url: jobUrl}})
        }});
      }} catch(e) {{ /* serveur non dispo — pas bloquant */ }}
    }}
    const visible = document.querySelectorAll('tr.job-row').length;
    const countEl = document.getElementById('pending-count');
    if (countEl) countEl.textContent = visible > 0 ? visible + ' offre' + (visible > 1 ? 's' : '') : '';
  }}

  function downloadLetterPDF() {{
    const label   = document.getElementById('modal-title').textContent;
    const company = label.split(' — ')[0].trim();
    const text    = document.getElementById('modal-letter-text').textContent;
    const docTitle = 'Lettre ' + company + ' — Gregoire Linée';
    const paras = text.split('\\n\\n').filter(p => p.trim()).map(p =>
      '<p style="margin:0 0 14px;line-height:1.7">' + p.trim().replace(/\\n/g,'<br>') + '</p>'
    ).join('');
    const html = '<html><head><meta charset="UTF-8"><title>' + docTitle + '</title>'
      + '<style>body{{font-family:Georgia,serif;max-width:660px;margin:40px auto;padding:0 32px;color:#1a1a2e;font-size:10.5pt;line-height:1.8}}'
      + 'h2{{font-size:13pt;margin-bottom:4px}}.info{{color:#888;font-size:9pt;margin-bottom:8px}}hr{{border:none;border-top:1px solid #ddd;margin:16px 0}}'
      + '.btn{{position:fixed;top:16px;right:16px;padding:8px 18px;background:#667eea;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600}}'
      + '@media print{{.btn{{display:none}}}}'
      + '#ubersuggest-app,[class*="ubersuggest"],[id*="ubersuggest"],[class*="grammarly"],[id*="grammarly"],'
      + '[class*="loom"],[id*="loom-companion"],[class*="notion-companion"],'
      + 'body>div[style*="position:fixed"]:not(.btn),body>div[style*="position: fixed"]:not(.btn),'
      + 'body>iframe,body>div:empty{{display:none!important}}'
      + '</style></head>'
      + '<body><button class="btn" onclick="window.print()">🖨 Imprimer / PDF</button>'
      + '<h2>Gregoire Linée</h2><p class="info">gregoire.linee@gmail.com · Paris</p><hr>'
      + '<p style="margin-bottom:20px;font-weight:600">' + label + '</p>'
      + paras + '</body></html>';
    const w = window.open('', '_blank');
    if (w) {{
      w.document.write(html);
      w.document.close();
      // Supprime les injections d'extensions (Ubersuggest, Grammarly, Loom…)
      // après le chargement car elles s'injectent après document.close()
      w.addEventListener('load', () => {{
        const kill = (n) => {{
          if (!n || n.nodeType !== 1) return;
          const id  = (n.id  || '').toLowerCase();
          const cls = (typeof n.className === 'string' ? n.className : '').toLowerCase();
          const tag = (n.tagName || '').toLowerCase();
          const st  = (n.getAttribute && n.getAttribute('style') || '').toLowerCase();
          if (id.includes('ubersuggest') || cls.includes('ubersuggest') ||
              id.includes('grammarly')   || cls.includes('grammarly')   ||
              id.includes('loom')        || cls.includes('loom')        ||
              tag === 'iframe'           ||
              (st.includes('position') && st.includes('fixed') && !n.classList.contains('btn'))) {{
            n.remove();
          }}
        }};
        // Nettoie ce qui est déjà là
        Array.from(w.document.body.children).forEach(kill);
        // Surveille les futures injections
        new w.MutationObserver(muts => {{
          muts.forEach(m => m.addedNodes.forEach(kill));
        }}).observe(w.document.body, {{ childList: true, subtree: false }});
      }});
    }} else alert('Autorise les pop-ups pour générer le PDF.');
  }}

  init();
</script>
</body>
</html>"""

    output_path.write_text(html, encoding="utf-8")
    return output_path
