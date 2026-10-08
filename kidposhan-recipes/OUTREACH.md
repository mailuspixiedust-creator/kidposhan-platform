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
