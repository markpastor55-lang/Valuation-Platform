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
