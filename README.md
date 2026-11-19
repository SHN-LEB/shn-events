# SHN Events

Event sales portal for Superheated Neurons: events home, per-event POS, inventory, cash, shifts, expenses and P&L.

- **App:** https://shn-leb.github.io/shn-events/ (GitHub Pages, files in this repository)
- **Back office:** Google Apps Script (`apps-script/Code.gs`) + Google Sheets
  - `SHN Events — Master` sheet: events list and settings (admin password, COGS %, defaults)
  - one Google Sheet per event, created in the `SHN Events` Drive folder

## One-time back office setup

1. Go to https://script.google.com and click **New project**. Name it `SHN Events`.
2. Delete everything in `Code.gs`, paste the whole content of [`apps-script/Code.gs`](apps-script/Code.gs), and save.
3. Project Settings (gear icon): set the time zone to **(GMT+02:00) Beirut**.
4. Back in the editor, choose **setup** in the function list and click **Run**. Approve the permissions.
   This creates the `SHN Events` Drive folder and the `SHN Events — Master` sheet.
5. Open the master sheet → **Settings** tab → change `ADMIN_PASSWORD`.
6. **Deploy → New deployment →** type **Web app**, Execute as **Me**, Who has access **Anyone** → Deploy.
   Copy the web app URL (ends with `/exec`) and paste it into `config.js` as `API_URL`.

## Updating the back office

Paste the new `Code.gs`, save, then **Deploy → Manage deployments →** pencil → Version **New version** → Deploy.
The URL stays the same.
