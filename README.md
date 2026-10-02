# VerdefSoft Technologies Co., Ltd.

Production: https://verdefsoft.me

A static B2B website for Industrial Automation, Machine Vision, Edge AI and Industrial Software. GitHub Pages serves the generated HTML directly from the existing `main` branch and repository root. No application server, package installation or deployment build is required.

## Editing

- `scripts/content.mjs`: team members, solution content, industry applications, concept projects and engineering notes.
- `scripts/build.mjs`: shared page templates, home/company/contact/legal content, navigation and metadata.
- `assets/site.css`: responsive design system.
- `assets/site.js`: mobile navigation, architecture tabs and the local email-draft tool.
- `assets/*.svg`: original technical diagrams and favicon.
- `assets/social-card.png`: social preview image.

Run `node scripts/build.mjs` after editing the content/templates. Commit the generated HTML, sitemap and source together. The generated pages are the deployed website; JavaScript is not required to read them or follow navigation.

## Structure

Home; Solutions and eight detail pages; Industries with eight application sections; Technology; Engineering Work and four concept detail pages; Company; Insights and three engineering notes; Contact; Privacy Policy; Terms of Use; custom 404.

## Contact behavior

The form only prepares a draft locally. Visitors must open their email application or copy the draft and send it themselves. No backend, tracking, local-storage persistence or success/delivery claim is present. The displayed domain mailboxes were supplied by the owner. Catch-all delivery and reply handling still depend on the owner’s email configuration.

## Content boundaries

All displayed projects are concepts/reference architectures, not verified prototypes, installations or customer case studies. The dashboard diagram is an illustrative interface. Technology names describe options; they do not imply vendor partnerships/certifications. No customers, metrics, testimonials, founding date, staff counts, offices, certifications or commercial outcomes are invented.

Replace concepts with evidenced engineering work when available. Add validated project scope, images with permission, acceptance results and deployment status. Add verified company/legal details and actual email operations when established.

The displayed company name is supplied by the owner. Team names and the founder/architecture role come from the owner's reference image. Other role labels have been adjusted to the site's industrial focus. Individual email aliases use `verdefsoft.me`; mailbox routing and delivery are handled by the owner's email configuration. No biographies, employment history or registration identifiers are added.

## Domain and recovery

`CNAME` contains `verdefsoft.me`; do not remove it or change DNS when editing site content. Existing Pages settings were preserved. The pre-upgrade commit is `59e6e71d7b0e921fde0362974a458fadc07837a4`, also preserved on `backup/pre-b2b-2026-10-01`. Prefer a revert commit for recovery rather than rewriting history.

The authenticated connector exposes repository and Actions data but does not expose the Pages settings API. The `main` deployment branch and repository-root source were verified from existing source and Pages workflow evidence; the custom domain and HTTPS were verified by requesting production.
