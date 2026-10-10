# Visitors, ratings, remarks, ₹5 support and author emails: setup

Everything is built and deployed. Each part switches on when you add its secrets. Until then it stays off and says so politely
(no OTP sent, no payment card shown, no email sent). Add secrets from the repo folder with `npx wrangler secret put NAME`.

| Part | Secrets | What happens without them |
|---|---|---|
| Name + mobile (needed to rate and to send remarks; the number is not verified) | none, works now | n/a |
| ₹5 support by UPI | `UPI_ID` (e.g. `name@okhdfcbank`), optional `UPI_PAYEE_NAME` | The support card is hidden |
| Gmail permission emails | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`, optional `OUTREACH_SIGNOFF` | Send and Check replies say Gmail is not connected |

## Name and mobile (no OTP)
Visitors type a name and a 10-digit mobile number once; it is remembered in their browser for 90 days. The number is **not verified**, so anyone can type any number.
That is acceptable because remarks are approved by you first, the public sees only the name, and one number can rate a recipe only once. Safeguards:
10 sign-ins an hour per number and 300 an hour in total. Visitors are kept in their own tables, apart from the main app's accounts.

## Tavily usage cap
Every Tavily search made by the recipe code is counted and capped at 25 a day (set `TAVILY_DAILY_CAP` to change it). The Sites tab shows today's count and,
when Tavily answers, the account's credits used.

## UPI (₹5)
Set `UPI_ID` to the UPI address that should receive the money. The page opens the visitor's UPI app with the amount fixed at ₹5.00.
UPI links cannot tell the site that a payment succeeded, so the visitor taps "I have paid" (optionally typing the UPI reference),
and the claim appears in **Admin, Visitors, ₹5 support payments**. Confirm it only after you see the money in your UPI app.
Payments are optional and unlock nothing.

## Gmail (permission emails to authors)
You do this once. It lets the Worker send as you and read replies to those emails only (it looks up the threads it started).
1. Google Cloud console, create a project, **enable the Gmail API**.
2. OAuth consent screen: type External. Add your Gmail address as a test user. (While the app is in "Testing", Google expires the
   refresh token after 7 days. For lasting use, click **Publish app**. It stays unverified and only you can use it.)
3. Credentials, **Create OAuth client ID**, type Web application, authorised redirect URI `https://developers.google.com/oauthplayground`.
   Copy the client ID and client secret.
4. Open https://developers.google.com/oauthplayground, click the gear, tick **Use your own OAuth credentials**, paste the ID and secret.
5. In Step 1 enter the scopes `https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly`, authorise with your Gmail,
   then **Exchange authorization code for tokens** and copy the **Refresh token**.
6. `npx wrangler secret put` for `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and `GMAIL_SENDER` (your Gmail address). Optionally `OUTREACH_SIGNOFF` (the name at the bottom of the email).

## Using it (Admin page)
- **Authors tab:** type each site's contact email, press **Preview email** to read exactly what will go, then **Send** (or **Send to all ready**, up to 20 at once).
  Nothing is sent without you pressing the button. One email per address, never repeated.
- Replies are read about every 30 minutes (or press **Check for replies now**) and shown as yes, no or other, with what they wrote.
  The wording is only a guess, so you confirm with **Mark as…**. Marking **Replied: no** offers to take that author's recipes down and hide their photos straight away.
  After 14 days with no reply a site shows as "No reply".
- **Visitors tab:** remarks wait here. Edit the wording if you like, then **Approve and publish** or **Reject**. You can take a published remark back. Payments to confirm are listed below.

## What the email says
It tells the author that KidPoshan uses their recipes with credit and a link, asks permission, says KidPoshan is not a selling site and that a portion
of any money made will be shared, mentions the optional ₹5 support, and asks for a YES or NO reply. It also says honestly that their recipes are already
live and will come down on a NO. Edit the wording in `src/recipes/outreach.js` (`buildMessage`) if you want it changed.

## Automatic sending and reading replies
Once Gmail is connected you can let the system do the routine work (Admin, Authors tab):
- **Finding addresses:** every 30 minutes it looks at a couple of sites that have live recipes but no address, reads their contact / about pages
  (respecting robots.txt and pacing), and saves an address on the site's own domain, or a personal Gmail-style address given as the contact. It never uses an
  address from an advertiser or agency. You can overwrite any address.
- **Sending:** the switch "Send the permission email automatically" is **off by default**. When on, it emails creators who have an address and live recipes,
  at most 5 every 30 minutes and no more than your daily limit (1 to 50, default 10). It never emails a site marked "Refused", and never the same site or
  address twice. Switch it off at any time. Test first with **Send test to me**.
- **Reading replies:** every 30 minutes it reads the threads it started. For each site the database now holds: **contacted** (date sent), **agreed**
  (yes / no / other reply / bounced / waiting) and a **phone number** if the creator wrote one (an Indian mobile or an international +number). Out-of-office
  replies are ignored, and the quoted copy of our own email is not read, so its YES and NO cannot confuse the result.
- **Your word is final:** the reading is a first guess. As soon as you use **Mark as…** on a site, the automatic reading never changes that site's status again
  (it may still add a missing phone number). A "no" never takes anything down by itself; you confirm that. You can type or correct a phone number.
- **Copy contacts as CSV** gives site, website, email, date contacted, agreed and phone for everyone who has been emailed.
