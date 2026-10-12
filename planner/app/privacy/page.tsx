import Link from 'next/link';
export default function Privacy() {
  return (
    <main className="school-panel">
      <h1>Your privacy in DueNext</h1>
      <p>
        DueNext is a student-built International Academy CAS project. It stores
        your assignments, class timetable, completion status, and events under
        your Google sign-in account. Other students and the school-calendar
        administrator cannot view your planner through the app.
      </p>
      <p>
        Firebase provides sign-in and database storage, and Vercel hosts the
        app. The project operator administers these services and may access
        records to resolve a support or security issue. Calendar dates are
        shared; your class names, notes, and assignments are private account
        data.
      </p>
      <p>
        Canvas is optional. A token grants the access allowed by Canvas; DueNext
        uses it to read your profile, courses, and assignments. Tokens are
        encrypted on the server and are never saved in browser storage. Checking
        off an assignment does not submit schoolwork.
      </p>
      <p>
        Google Calendar is optional. With your permission, DueNext reads events
        from your primary calendar and creates a separate DueNext calendar for
        your plans. Writes are limited to that separate calendar. Disconnecting
        removes the saved connection and attempts to revoke its authorization.
      </p>
      <p>
        Sign-in lasts for the current browser session unless you choose Remember
        me. Sign out on shared computers. Connected CYD displays retain the last
        calendar; clear the display before lending it to someone.
      </p>
      <p>
        Export or delete your planner in My data &amp; account. Deletion removes
        active planner data and saved credentials, while a minimal deletion
        marker prevents interrupted writes from restoring your account. Service
        backups follow the operator’s documented retention settings. Your Google
        calendar and Canvas account are not deleted.
      </p>
      <p>
        Operational logs record status and timing rather than assignment
        contents or credentials. DueNext does not sell student data or use it
        for advertising.
      </p>
      <p>
        For support, contact the student project organizer who shared DueNext
        with your school. Do not send passwords or access tokens in support
        messages. Support email: coming soon.
      </p>
      <Link href="/">Return to DueNext</Link>
    </main>
  );
}
