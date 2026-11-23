# MALOW - November 2026 updates

Slideshow, comfort video and 10% email sign-up.

## What changed in the theme (`theme/`)

| File | Change |
|---|---|
| `sections/malow-hero.liquid` | The single hero image is now a sliding carousel. Add **Slide** blocks (image or video, with optional separate mobile video/image) or **Portrait trio** blocks (3 portrait clips side by side on desktop, first one only on mobile). It auto-rotates every 5s (adjustable), pauses on hover, and has arrows, dots, swipe on mobile and a badge on/off toggle. It shows the old image until slides are added. |
| `snippets/malow-hero-media.liquid` | **New.** Renders each slide's video (muted, looping, inline) or image. |
| `sections/malow-why.liquid` | The new **Comfort video** setting plays above the footbed diagram, which stays. The video only plays while it's on screen. |
| `sections/malow-newsletter-popup.liquid` | **New.** The 10% sign-up pop-up. It uses Shopify's own customer form, so sign-ups go into Customers as subscribed to email marketing, tagged `newsletter`. Visitors see it once after 8s, and it hides for 14 days after closing. It also opens from `?newsletter=open` or `#newsletter`. |
| `layout/theme.liquid` | Adds the pop-up section after the footer. |
| `assets/malow-custom.css` | New styles are appended at the bottom, under "NOV 2026 ADDITIONS". |

These are only the custom MALOW files, the same as before. Upload them over the live theme. **Duplicate the live theme first** and make the changes on the copy.

## Go-live checklist

### 1. Theme
1. Shopify > Online Store > Themes > live theme > **... > Duplicate**.
2. On the duplicate, open **Edit code**. Replace or add the 6 files above. Copy the contents of each file and paste them in.
   - `malow-custom.css`: only paste the block under "NOV 2026 ADDITIONS" at the bottom of the live file, in case anything was tweaked live.
   - `theme.liquid`: only add the 2 lines for the pop-up after `{%- section 'footer' -%}`, rather than replacing the whole file.
3. **Customise** the duplicate:
   - **MALOW Hero**: add the slides and pick the videos and images. Upload them under Content > Files first. If the videos are portrait, use **Portrait trio** or set "Banner shape on mobile" to Portrait.
   - **MALOW Why Section**: pick the comfort video.
   - **MALOW Sign-up pop-up** (theme settings / layout): check the wording and code.
4. Preview on desktop and mobile, then **Publish**.

### 2. Discount + checkout
1. Discounts > Create > Amount off order: **WELCOME10**, 10%, limit to one use per customer.
2. Settings > Checkout > Marketing options: tick **Show a sign-up option at checkout** (leave it unticked by default).

### 3. Order confirmation email
Settings > Notifications > Order confirmation > Edit code. Paste in `email-snippets/order-confirmation-join-list.html` above the footer. It only shows to customers who aren't already subscribed.

### 4. Welcome email (Resend) - `malow-welcome-email/`
1. Resend: add and verify the **malowlondon.com** domain. Add the DNS records at Names.co.uk.
2. Resend: create an API key (and optionally a "Newsletter" segment).
3. Deploy `malow-welcome-email/` to Vercel as a new project. Add the env vars from `.env.example`.
4. Shopify > Settings > Notifications > Webhooks: create **Customer creation** and **Customer update** webhooks (JSON) pointing at `https://<vercel-url>/api/shopify-customer`. Copy the signing secret shown there into `SHOPIFY_WEBHOOK_SECRET`.
5. Test: sign up in the pop-up with a test email. You should get the welcome email with WELCOME10.

The welcome email goes to anyone who subscribes via the pop-up or the checkout tick box. Each person gets it once, because the function checks whether they're already a Resend contact. Everyone also ends up in Resend Contacts, ready for promo emails later.
