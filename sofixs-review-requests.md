# Sofixs — Getting Real Client Reviews (Email Template + Steps)

> Only real reviews from real clients. Each review below is sent by you to a client who actually
> worked with Sofixs. Do not write reviews yourself — Google, GoodFirms, and Clutch detect and
> remove fake reviews and can permanently block a business profile.

---

## 1. Review-Request Email (send to each real client)

**Subject:** Quick question about working with Sofixs

Hi [Client Name],

Thank you again for trusting Sofixs with [project name]. We really enjoyed building
[website / app / HR system] with you.

If you were happy with the outcome, it would mean a lot to us if you could share a few words
about the experience. It takes about 2 minutes and helps other businesses in Nepal discover us.

Click here to leave a review: [Google Review Link]
Optional: [GoodFirms Link] · [Clutch Link] · [Facebook Link]

A short review is perfect — one or two sentences about what we built and what changed for your
business.

With thanks,
[Sender Name]
Sofixs · Kathmandu / Janakpur, Nepal
[email] · [phone]

---

## 2. Review-Collection Form (simple, optional)

Create a Google Form ("Sofixs Client Feedback") with these fields and link it in the same email:

1. Your name
2. Company name
3. What did Sofixs build for you?
4. What result did you see? (e.g., faster check-in, fewer payroll errors, more customers)
5. Would you recommend Sofixs? (1–5 stars)
6. One sentence we can quote publicly (with your permission)

Then paste the best responses (with written permission) into the testimonials section on the website.

---

## 3. Where to Post Reviews

| Platform | Why | Minimum to matter |
|---|---|---|
| Google Business Profile | Shows in search/maps; most trusted | 5+ |
| GoodFirms | You already have a profile (`goodfirms.co/company/sofixs`) | 5+ |
| Clutch | Top-tier directory (profile needs to be created) | 3+ |
| Facebook | Local trust signal | 5+ |
| LinkedIn | B2B credibility | 3+ recommendations |

---

## 4. How to Ask Without Sounding Pushy

- Ask **specific clients** (projects completed ≥ 1 month ago).
- Make it **one click** — send the direct review link, not "find us on Google."
- **Follow up once** after ~5 days. Then stop.
- Never offer discounts/incentives for reviews (violates Google policy).
- Add a review button to your **post-project handover email** so asking becomes routine.

---

## 5. Once You Have Reviews

1. Add them to `Sofixs_Website/Frontend/src/components/home/TestimonialsSection.tsx` — the
   scrollable marquee renders whatever real reviews are in the `REVIEWS` array.
2. Ask each reviewer for written permission before publishing their name/company publicly.
3. Never invent or edit a review to say something the client didn't say.
