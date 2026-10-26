import { PageShell } from './PageShell'

/**
 * Terms and conditions.
 *
 * Written as plain-language terms for using the HR MAX service. Nothing here
 * invents certifications, guarantees or refund promises; where a commercial
 * term is set by contract, the page says so and points to the team.
 */
export function Terms() {
  return (
    <PageShell
      title="Terms and Conditions — HR MAX"
      description="Terms governing the use of the HR MAX platform provided by Sofixs, including accounts, acceptable use, availability and contact."
      eyebrow="Legal"
      h1="Terms and Conditions"
      lede="These terms describe the rules for using HR MAX. Commercial details such as fees, term length and refunds are set out in your agreement with Sofixs."
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Terms & Conditions' }]}
      hideCta
    >
      <div className="doc-section legal-copy">
        <p className="legal-updated">Last updated: 25 October 2026</p>

        <h2>1. About these terms</h2>
        <p>
          HR MAX is a human resource management platform provided by Sofixs. By creating an
          account, enrolling an organization or otherwise using the service, you agree to these
          terms on behalf of yourself and, where you act for an organization, on behalf of that
          organization. If you do not agree, do not use the service.
        </p>

        <h2>2. Accounts and access</h2>
        <p>
          Access is personal to the assigned user. You are responsible for keeping your
          credentials confidential and for all activity under your account. Roles and permissions
          are configured by your organization's administrators; access may be changed or revoked
          by an administrator at any time.
        </p>
        <p>
          Accounts created through enrollment remain subject to verification and approval. Submitting
          an enrollment request does not guarantee activation.
        </p>

        <h2>3. Acceptable use</h2>
        <p>You must not:</p>
        <ul>
          <li>use the service to store or process data you are not authorized to handle;</li>
          <li>attempt to access another organization's data or circumvent role restrictions;</li>
          <li>interfere with the service, probe its security, or introduce malicious code;</li>
          <li>resell, sublicense or reverse engineer the platform except where permitted by law;</li>
          <li>use the service for any unlawful purpose.</li>
        </ul>

        <h2>4. Customer data</h2>
        <p>
          Your organization retains ownership of the data it submits to HR MAX, including employee
          records. Sofixs processes that data to provide the service. Data handling, retention and
          deletion are described in the <a href="/privacy">Privacy Policy</a>. To request deletion
          of an account or associated data, use the <a href="/delete-account">account deletion</a> page.
        </p>

        <h2>5. Fees, term and refunds</h2>
        <p>
          Pricing, billing periods, contract length and any refund entitlement are not published on
          this website. They are confirmed in writing by the HR MAX team as part of your agreement.
          Nothing on this site should be read as a price quote, discount or money-back guarantee.
        </p>

        <h2>6. Availability and support</h2>
        <p>
          We aim to keep the service available and will communicate material service issues through
          the contact channels provided. Unless a separate agreement states otherwise, no specific
          uptime percentage or response time is promised here.
        </p>

        <h2>7. Suspension and termination</h2>
        <p>
          Access may be suspended or terminated where these terms are breached, where required by
          law, or at the end of an agreed contract term. On termination, your organization may
          request export or deletion of its data in line with the Privacy Policy.
        </p>

        <h2>8. Intellectual property</h2>
        <p>
          The HR MAX platform, its interfaces and its documentation remain the property of Sofixs
          or its licensors. Feedback you provide may be used to improve the service.
        </p>

        <h2>9. Changes to these terms</h2>
        <p>
          We may update these terms as the product or law changes. Material changes will be posted
          on this page with an updated date. Continued use after a change takes effect constitutes
          acceptance of the revised terms.
        </p>

        <h2>10. Contact</h2>
        <p>
          Questions about these terms can be sent through the <a href="/contact">contact page</a> or
          by email to <a href="mailto:info@hrmax.in">info@hrmax.in</a>.
        </p>
      </div>
    </PageShell>
  )
}
