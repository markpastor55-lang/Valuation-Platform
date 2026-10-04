# Going live: what we need from you

The demo runs entirely in a browser with made-up data. The server behind it is built and tested
but not yet deployed. That covers the rules engine, database, security, audit trail, PDF reports,
the CoreLogic connection and the market commentary library. Three things turn it into a running
app:

1. **Accounts and services set up in the firm's name** (section 1). Only you can open these.
2. **Firm details and report content** (sections 2 and 3). The app needs your wording, people and
   settings.
3. **The remaining build** (section 5): a production front end that signs people in and saves to
   the server, then a pilot. This is our work, not something you supply.

Never send passwords, API keys or secrets by chat or email. Each service below lets you add a
person or a role instead. Keys go straight into the hosting provider's secret store.

## Answers so far (4 October 2026)

| Item                        | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Firm name                   | Not chosen yet. Working name for the app and reports: **Fair Market Valuations**; change it any time before go-live.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Domain (1.2)                | `fairmarketvaluations.com.au`, registered and DNS-hosted at GoDaddy. The app will live on a subdomain such as `app.fairmarketvaluations.com.au`, so the website and email are not touched.                                                                                                                                                                                                                                                                                                                                                                               |
| Microsoft 365               | Email for the domain runs on Microsoft 365, bought through GoDaddy. GoDaddy keeps some admin control of these accounts, which can block app sign-in (1.3) and sending as a mailbox. We'll test this first; the fix, if needed, is to move the subscription to Microsoft directly.                                                                                                                                                                                                                                                                                        |
| Email sending (1.4)         | Deferred. App emails will come from `info@fairmarketvaluations.com.au` through Microsoft 365. (The spelling `fairmarketvaluation.com.au`, without the "s", does not exist as a domain.)                                                                                                                                                                                                                                                                                                                                                                                  |
| Standards owner (section 2) | Mark Pastor, with Ben as the second approver. The app won't let anyone approve their own work, so one writes and the other approves.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Report wording (section 3)  | Draft standard clauses are in the app (`FIRM_TEMPLATE`): certification, reliance, general assumptions and limitations, restricted and desktop inspections, retrospective valuations, the family law expert's declaration, fair value, insurance cost estimates, areas and software use. They are the firm's own wording, not copied from any professional body's template, and they stay drafts until Mark approves each one after legal and insurer review. No "liability limited by a scheme" line is included: that needs membership of an approved scheme.           |
| Logo                        | Still needed. Attach it in the chat (PNG or JPEG), or allow `fairmarketvaluations.com.au` in the environment's network settings so it can be taken from the website. The report cover already has a place for it.                                                                                                                                                                                                                                                                                                                                                        |
| Market commentary cadence   | National and state commentary is published monthly; anything more than a month older than the valuation date is flagged. Local commentary is written per area and must be current when the report is prepared: a current valuation gets the latest local paragraph as at that day, and the valuer is warned before sending to QA if a newer one has been approved. A retrospective valuation uses the commentary as at its valuation date. Commentary is required for every report that states a value or rent; it is optional for insurance replacement cost estimates. |

### Adding DNS records at GoDaddy

You don't need to give anyone your GoDaddy login. When the app is ready to deploy, we'll send a
short list of records (usually one to three: type, name and value). To add them:

1. Sign in at godaddy.com and go to **My Products**.
2. Next to `fairmarketvaluations.com.au`, open **DNS** (sometimes shown as **Manage DNS**).
3. Choose **Add New Record**, pick the type (for example CNAME or TXT), and paste the name and
   value exactly as sent. Save.

Changes usually take effect within an hour. Leave the existing MX, TXT and root A records alone:
they run your email and website.

If someone else (for example Ben or an IT helper) should do this, GoDaddy's **Delegate Access**
(under Account Settings) lets you invite them with access to products and domains only. Never
share your own password.

## 1. Accounts and services (in the firm's name)

| #   | What                                      | Why the app needs it                                                                                                  | Suggested choice                                                                                        | What to give us                                                                                           |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1.1 | Cloud hosting account, Australian region  | Runs the server, the PostgreSQL database and encrypted storage for photos and reports, with backups kept in Australia | AWS (Sydney) or Microsoft Azure (Australia East). Pick Azure if the firm already runs on Microsoft 365. | Add us as a user with a limited role; billing stays with you                                              |
| 1.2 | Domain name                               | The address people use, e.g. `app.yourfirm.com.au`                                                                    | A subdomain of your existing website                                                                    | Access to edit DNS records (or your IT provider adds the records we send)                                 |
| 1.3 | Sign-in with multi-factor authentication  | Only the valuer can sign, with MFA; QA and issue need MFA too                                                         | Microsoft Entra ID if you use Microsoft 365; otherwise Okta or Auth0                                    | Permission to register the app (we send the exact settings)                                               |
| 1.4 | Email sending                             | Sends reports and invoices from your domain                                                                           | Amazon SES or Postmark                                                                                  | DNS access for the sender records (SPF, DKIM, DMARC)                                                      |
| 1.5 | CoreLogic (Cotality) licence and API keys | Property details, comparable sales, sales history and the automated estimate                                          | Your CoreLogic account manager. Ask for API access for valuation use.                                   | The signed licence terms (storage, use in reports), and the keys entered by you into the secret store     |
| 1.6 | Map licence                               | Location maps in the app and reports                                                                                  | State government map services (free, with attribution), or Esri or Google if you prefer                 | Confirmation of the attribution and terms you are happy with                                              |
| 1.7 | App stores (optional)                     | Puts the app in Google Play and the Apple App Store                                                                   | Not needed for a pilot: the app installs from the browser on Android and desktop                        | A Google Play developer account (and an Apple developer account for iPhones) when you want store listings |

## 2. Firm details and people

- **Firm details:** legal name, ABN, address, logo, brand colours, report footer wording, GST
  registration, invoice terms and the bank details printed on invoices.
- **People:** name, email and role for each user (valuer, QA reviewer, administrator, finance).
  Each valuer completes their own profile in the app: signature, API member number, and their
  Queensland registration or WA licence where they value there.
- **Standards owner:** a senior valuer who approves report wording, rules and market commentary.
  The app stops anyone approving their own work, so you need at least one other approver.
- **Fees and turnaround:** your fee schedule and standard turnaround times, which set due dates.
- **Clients (optional):** a list of regular clients and their report recipients to import.

## 3. Report content

- **Report wording (most important).** The app ships with placeholders, not proprietary
  templates, so no report can be issued until your wording is approved. We need your current
  wording for:
  - the certification and reliance statements;
  - general limitations and restricted or desktop inspection limitations;
  - the retrospective (information cut-off) statement;
  - the family law expert declaration;
  - the fair value basis;
  - insurance cost limitations;
  - the area and measurement disclaimer.

  Your lawyer and professional indemnity insurer should review it.

- **Market commentary.** The app now offers national, state and local commentary matched to the
  property type and suburb, as at the valuation date. The valuer then tailors it. Decide:
  - **who writes it and how often.** Suggested: national and state each quarter; local paragraphs
    for your core suburbs and councils, updated as markets move.
  - **which suburbs and councils** to write local paragraphs for first.
  - **who approves it.** This is the standards owner; it can't be the author.
  - **which sources you may quote.** CoreLogic figures in a report need a licence that allows it;
    RBA, ABS and government releases are generally fine to cite.

  The demo library is placeholder text (no figures, clearly labelled as demonstration content).
  It must be replaced before live use.

## 4. Decisions to confirm

| Decision                           | Our default                                                               |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Hosting                            | AWS Sydney, with disaster recovery in Melbourne                           |
| Mobile app                         | Installable web app first; store apps later if wanted                     |
| Report signing                     | Typed signature plus MFA; a digital certificate later if clients ask      |
| Record retention                   | 7 years from issue, with legal hold                                       |
| CGT reports                        | In the first release (the backlog lists it for the pilot; we'll align it) |
| Who can see the automated estimate | The valuer only, never in reports                                         |

## 5. What happens next (our side)

1. **Deploy** the server and database to your Australian hosting account. Then connect sign-in,
   email and storage, and load your firm details.
2. **Build the production front end.** It is the same screens as the demo, but it signs people in,
   saves jobs to the server so they're shared across phone and desktop, and uploads photos.
   Offline inspection comes next.
3. **Connect CoreLogic** once your keys are in the secret store, and check the endpoints against
   their developer portal.
4. **Load your content:** report wording, commentary library and users. Then the standards owner
   approves it.
5. **Pilot** with one or two valuers on real jobs alongside your current process, with a QA
   reviewer. We fix what the pilot finds, then go live.

Items 1.1 to 1.4 and your report wording are the critical path. Everything else can follow during
the pilot.
