import Link from 'next/link';
export default function Help() {
  return (
    <main className="school-panel">
      <h1>Using DueNext</h1>
      <ol>
        <li>
          Sign in with your own Google account. Leave Remember me off on school
          computers.
        </li>
        <li>
          Open My A/B timetable and enter your classes. Blue dates in
          International Academy’s official calendar are B days; white school
          dates are A days.
        </li>
        <li>
          Add assignments manually, with an optional due date, or connect your
          own Canvas token in Connections. Undated assignments appear in My
          tasks.
        </li>
        <li>
          Connect Google Calendar when available. Your primary calendar is
          read-only; plans sync with the separate DueNext calendar while this
          app is open.
        </li>
      </ol>
      <p>
        Early-release and special days may have different class times. Check the
        official school schedule; DueNext does not guess those times or
        unpublished dates.
      </p>
      <p>
        If a save fails, your changes are not saved. Keep the form open and
        retry. If another device changed an item, reload before editing again.
        DueNext requires an internet connection and never silently switches to
        local-only storage.
      </p>
      <p>
        Canvas token creation or Google authorization may be blocked by school
        settings. Manual tracking remains available. Checking an assignment
        complete here never submits it in Canvas.
      </p>
      <p>
        CYD displays are optional and require desktop Chrome or Edge with USB
        support. Other browsers can still use the planner. Connect the display
        and choose Clear saved display calendar before sharing the device.
      </p>
      <p>
        Use My data &amp; account to download your planner or delete it. Contact
        the project organizer for support; never share credentials. Support
        email:{' '}
        <a href="mailto:arda.sarioglu@icloud.com">arda.sarioglu@icloud.com</a>.
      </p>
      <a
        href="https://www.iatoday.org/tri-campus/graphic-calendar"
        target="_blank"
        rel="noreferrer"
      >
        Official IA calendar
      </a>
      <br />
      <Link href="/">Return to DueNext</Link>
    </main>
  );
}
