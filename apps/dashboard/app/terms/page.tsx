export const metadata = { title: 'Terms - Dcbot' };

export default function TermsPage(): JSX.Element {
  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 48, maxWidth: 820 }}>
      <h1>Terms</h1>
      <div className="card">
        <ul>
          <li>You are responsible for how you configure and use this bot in your servers.</li>
          <li>Use of Dcbot must comply with Discord&apos;s Terms of Service and Community Guidelines.</li>
          <li>
            The economy system is a virtual game currency with no real-world value. No feature converts it into money,
            and no gambling with real money is supported.
          </li>
          <li>
            Security features act only within what Discord&apos;s API allows. The bot cannot prevent an action Discord has
            already delivered; where it reacts after the fact, the documentation says so.
          </li>
          <li>The software is provided under the MIT licence, without warranty.</li>
        </ul>
      </div>
    </div>
  );
}
