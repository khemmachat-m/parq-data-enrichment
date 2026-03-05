# PARQ Data Enrichment Web App  v2

**Project:** JOB152 Smart City OB – The PARQ  
**Stack:** Vite + Vanilla JS + PapaParse — runs 100% in the browser

---

## How It Works

### Master Data (auto-loaded — no upload needed)
Five reference tables are **bundled in `/public/master-data/`** and fetched automatically when the app loads:

| File | Description |
|------|-------------|
| `MZ_PARQ_Priorities.csv` | Priority categories |
| `MZ_PARQ_Assets.csv` | Asset registry |
| `MZ_PARQ_Locations.csv` | Location hierarchy |
| `MZ_PARQ_EventTypes.csv` | Event type definitions |
| `MZ_PARQ_ProblemTypesTemplate.csv` | Problem type metadata |

Loading priority:  **Server file → IndexedDB cache (offline) → User upload**

Each master card shows one of three states:
- 🟢 **Server** — freshly fetched from the bundled file
- 🔷 **Cached** — loaded from browser storage (offline or server unavailable)
- 🟠 **Override** — user uploaded a newer version this session

Every master card has an **Update** button to upload a fresh file, and a **↺ Revert** button to go back to the server version.

### Transaction Files (upload each session)
Only **CWO** and **Cases** need to be uploaded each time you run an enrichment.

---

## Run Locally

```bash
npm install
npm run dev       # → http://localhost:5173
```

## Deploy to GitHub Pages

1. Push repo to GitHub
2. **Settings → Pages → Source → GitHub Actions**
3. Confirm repo name in `vite.config.js`:
   ```js
   base: process.env.GITHUB_PAGES ? '/parq-data-enrichment/' : '/',
   ```
4. Push to `main` — workflow auto-builds & deploys

Live at: `https://YOUR_USERNAME.github.io/parq-data-enrichment/`

---

## Updating Master Data

When you export fresh master tables from Mozart:

### Option A — Update in the app
Click **↑ Update** on any master card to upload a new file.  
It will be saved to browser storage and used for all future sessions on that device.

### Option B — Update the bundled server files
Replace the files in `/public/master-data/` with new exports:

```bash
cp MZ_PARQ_Priorities_YYYYMMDD.csv   public/master-data/MZ_PARQ_Priorities.csv
cp MZ_PARQ_Assets_YYYYMMDD.csv       public/master-data/MZ_PARQ_Assets.csv
cp MZ_PARQ_Locations_YYYYMMDD.csv    public/master-data/MZ_PARQ_Locations.csv
cp MZ_PARQ_Event_TypesYYYYMMDD.csv   public/master-data/MZ_PARQ_EventTypes.csv
cp MZ_PARQ_ProblemTypesTemplate.csv  public/master-data/MZ_PARQ_ProblemTypesTemplate.csv
```

Update `lastUpdated` in `public/master-data/manifest.json`, then push to deploy.  
All users will automatically get the new master data on next page load.

---

## File Structure

```
parq-data-enrichment/
├── index.html
├── package.json
├── vite.config.js
├── public/
│   └── master-data/            ← Bundled master CSVs (no upload needed)
│       ├── manifest.json
│       ├── MZ_PARQ_Priorities.csv
│       ├── MZ_PARQ_Assets.csv
│       ├── MZ_PARQ_Locations.csv
│       ├── MZ_PARQ_EventTypes.csv
│       └── MZ_PARQ_ProblemTypesTemplate.csv
├── src/
│   ├── main.js                 ← UI + master fetch/cache logic
│   ├── enrichment.js           ← Data join engine (port of Python script)
│   ├── csvUtils.js             ← CSV parse + download
│   ├── masterStorage.js        ← IndexedDB cache layer
│   └── style.css
└── .github/workflows/
    └── deploy.yml              ← GitHub Pages CI/CD
```

---

## Privacy
All processing is **100% in the browser**. No data is sent to any server.
