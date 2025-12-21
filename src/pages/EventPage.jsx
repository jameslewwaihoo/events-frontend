import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function firstLaravelError(errors) {
  if (!errors || typeof errors !== "object") return "";
  const firstKey = Object.keys(errors)[0];
  const val = errors[firstKey];
  if (Array.isArray(val) && val[0]) return val[0];
  if (typeof val === "string") return val;
  return "";
}

function formatIsoToLocal(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function formatSessionLabel(s) {
  const name = s?.name || `Session #${s?.id}`;
  const time = s?.start_at ? formatIsoToLocal(s.start_at) : "";
  const loc = s?.location ? ` @ ${s.location}` : "";
  return time ? `${name} (${time}${loc})` : `${name}${loc}`;
}

// Deadline check in GMT+8 (Asia/Singapore):
// RSVP allowed on deadline day, closed only when today(SGT) > deadline
function isAfterDeadlineSGT(rsvpDeadlineYYYYMMDD) {
  if (!rsvpDeadlineYYYYMMDD) return false;

  const m = String(rsvpDeadlineYYYYMMDD).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;

  const deadlineKey = `${m[1]}-${m[2]}-${m[3]}`;

  const todaySGT = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"

  return todaySGT > deadlineKey;
}

export default function EventPage() {
  const { slug } = useParams();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [lookupKey, setLookupKey] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupMsg, setLookupMsg] = useState("");


  // RSVP states (match your backend validation)
  const [form, setForm] = useState({
    attendance_status: "attending", // required: attending|declined
    name: "",
    email: "",
    phone: "",
    session_id: "", // optional, string for <select>
    remarks: "", // optional
    invite_code: "", // optional (future)
    allow_public_share: false,
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [submitOk, setSubmitOk] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setErr("");
        setEvent(null);

        const res = await fetch(`/api/public/events/${slug}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          if (res.status === 404) return;
          throw new Error(`API error ${res.status}`);
        }

        const data = await res.json();
        setEvent(data);

        const sessions = data?.sessions ?? [];
        if (sessions.length > 0) {
          setForm((prev) => ({
            ...prev,
            session_id: prev.session_id || String(sessions[0].id),
          }));
        }
      } catch (e) {
        if (e.name === "AbortError") return;
        setErr(String(e.message || e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    if (slug) load();
    return () => controller.abort();
  }, [slug]);

  useEffect(() => {
    // If declined, clear session_id so we don't send it accidentally
    if (form.attendance_status === "declined" && form.session_id) {
      setForm((prev) => ({ ...prev, session_id: "" }));
    }
  }, [form.attendance_status]); // intentionally only depend on attendance_status


  const sessions = useMemo(() => event?.sessions ?? [], [event]);

  const isRsvpClosed = useMemo(() => {
    return isAfterDeadlineSGT(event?.rsvp_deadline);
  }, [event?.rsvp_deadline]);

  const fieldErrors = useMemo(() => {
    const errs = {};

    if (!form.attendance_status) errs.attendance_status = "Please select attendance";
    else if (!["attending", "declined"].includes(form.attendance_status)) {
      errs.attendance_status = "Invalid attendance option";
    }

    if (!String(form.name).trim()) errs.name = "Name is required";

    const emailTrim = String(form.email || "").trim();
    if (emailTrim && !isValidEmail(emailTrim)) errs.email = "Email format looks wrong";

    if (String(form.phone || "").length > 50) errs.phone = "Phone is too long";
    if (String(form.remarks || "").length > 1000) errs.remarks = "Remarks is too long";
    if (String(form.invite_code || "").length > 50) errs.invite_code = "Invite code is too long";

    return errs;
  }, [form]);

  const canSubmit = Object.keys(fieldErrors).length === 0 && !submitting && !isRsvpClosed;

  function onFormChange(e) {
    const { name, value, type, checked } = e.target;
    setSubmitOk("");
    setSubmitErr("");
    setForm((prev) => ({ ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function buildPayload() {
    const payload = {
      attendance_status: form.attendance_status,
      name: String(form.name).trim(),
      email: String(form.email || "").trim() || null,
      phone: String(form.phone || "").trim() || null,
      remarks: String(form.remarks || "").trim() || null,
      invite_code: String(form.invite_code || "").trim() || null,
    };

    if (form.attendance_status !== "declined" && form.session_id) {
      payload.session_id = Number(form.session_id);
    }

    if (form.attendance_status === "declined") {
      payload.allow_public_share = !!form.allow_public_share;
    }

    return payload;
  }

  async function onSubmitRSVP(e) {
    e.preventDefault();
    setSubmitOk("");
    setSubmitErr("");

    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/events/${encodeURIComponent(slug)}/rsvp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(buildPayload()),
      });

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await res.json() : await res.text();

      if (!res.ok) {
        const msg =
          (data && typeof data === "object" && (data.message || firstLaravelError(data.errors))) ||
          (typeof data === "string" && data) ||
          `Submit failed (${res.status})`;
        throw new Error(msg);
      }

      const mode = data?.mode;
      setSubmitOk(mode === "updated" ? "RSVP updated! ✅" : "RSVP submitted! 🎉");

      setForm((prev) => ({
        ...prev,
        attendance_status: "attending",
        name: "",
        email: "",
        phone: "",
        remarks: "",
        invite_code: "",
        allow_public_share: false,
        // keep session_id selection
      }));
    } catch (e2) {
      setSubmitErr(String(e2?.message || e2));
    } finally {
      setSubmitting(false);
    }
  }

  async function onLookupRsvp() {
    setLookupMsg("");
    const key = String(lookupKey || "").trim();
    if (!key) {
      setLookupMsg("Enter your email, phone, or invite code.");
      return;
    }

    setLookupLoading(true);
    try {
      // Decide param type:
      // - contains "@" => email
      // - starts with + or has lots of digits => phone
      // - otherwise invite_code
      const params = new URLSearchParams();
      if (key.includes("@")) params.set("email", key);
      else if (/^\+?\d[\d\s-]{6,}$/.test(key)) params.set("phone", key.replace(/\s+/g, ""));
      else params.set("invite_code", key);

      const res = await fetch(`/api/public/events/${encodeURIComponent(slug)}/rsvp?` + params.toString(), {
        headers: { Accept: "application/json" },
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data?.message || "Lookup failed";
        throw new Error(msg);
      }

      if (!data?.found) {
        setLookupMsg("No RSVP found with that info.");
        return;
      }

      const d = data.data || {};
      setForm((prev) => ({
        ...prev,
        attendance_status: d.attendance_status || prev.attendance_status || "attending",
        name: d.name ?? "",
        email: d.email ?? "",
        phone: d.phone ?? "",
        remarks: d.remarks ?? "",
        invite_code: d.invite_code ?? prev.invite_code ?? "",
        session_id: d.session_id ? String(d.session_id) : "",
      }));

      setLookupMsg("RSVP loaded ✅ You can update and resubmit.");
    } catch (e) {
      setLookupMsg(e?.message || "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  }


  return (
    <div style={{ padding: 20, textAlign: "left", maxWidth: 900, margin: "0 auto" }}>
      <h1>{event?.title || "Event"}</h1>

      {event?.welcome_message ? <p>{event.welcome_message}</p> : null}

      <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
        {event?.event_date ? (
          <div>
            <b>Date:</b> {event.event_date}
          </div>
        ) : null}

        {event?.venue_name ? (
          <div>
            <b>Venue:</b> {event.venue_name}
          </div>
        ) : null}

        {event?.venue_address ? (
          <div>
            <b>Address:</b> {event.venue_address}{" "}
            {event?.venue_map_url ? (
              <>
                (
                <a href={event.venue_map_url} target="_blank" rel="noreferrer">
                  Map
                </a>
                )
              </>
            ) : null}
          </div>
        ) : null}

        {event?.rsvp_deadline ? (
          <div>
            <b>RSVP Deadline (GMT+8):</b> {event.rsvp_deadline}
          </div>
        ) : null}
      </div>

      {loading && <p style={{ marginTop: 14 }}>Loading…</p>}
      {err && <p style={{ color: "crimson", marginTop: 14 }}>Error: {err}</p>}

      {!loading && !err && !event && (
        <p style={{ color: "crimson", marginTop: 14 }}>
          No event found for slug: <b>{slug}</b>
        </p>
      )}

      {event && sessions.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <h3>Sessions</h3>
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>{formatSessionLabel(s)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <hr style={{ margin: "18px 0", border: 0, borderTop: "1px solid #ddd" }} />

      <h2>RSVP</h2>

      {isRsvpClosed ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #fde68a",
            background: "#fffbeb",
            color: "#92400e",
            marginBottom: 10,
          }}
        >
          RSVP is closed. (Deadline was <b>{event?.rsvp_deadline}</b>, GMT+8)
        </div>
      ) : null}

      {submitOk && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #bbf7d0",
            background: "#ecfdf5",
            color: "#166534",
            marginBottom: 10,
          }}
        >
          {submitOk}
        </div>
      )}

      {submitErr && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #fecdd3",
            background: "#fff1f2",
            color: "#9f1239",
            marginBottom: 10,
          }}
        >
          {submitErr}
        </div>
      )}

      <div style={{ marginBottom: 12, display: "grid", gap: 8, maxWidth: 720 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={lookupKey}
            onChange={(e) => setLookupKey(e.target.value)}
            placeholder="Enter email / phone to load your RSVP"
            style={{ ...inputStyle, flex: 1 }}
            disabled={isRsvpClosed}
          />
          <button
            type="button"
            onClick={onLookupRsvp}
            disabled={lookupLoading || isRsvpClosed}
            style={{ ...btnStyle, padding: "10px 12px" }}
          >
            {lookupLoading ? "Loading…" : "Find my RSVP"}
          </button>
        </div>

        {lookupMsg ? (
          <small style={{ color: lookupMsg.includes("✅") ? "green" : "crimson" }}>
            {lookupMsg}
          </small>
        ) : null}
      </div>


      <form onSubmit={onSubmitRSVP} style={{ display: "grid", gap: 12, maxWidth: 720 }}>
        <label style={{ display: "grid", gap: 6 }}>
          Attendance *
          <select
            name="attendance_status"
            value={form.attendance_status}
            onChange={onFormChange}
            style={inputStyle}
            disabled={isRsvpClosed}
          >
            <option value="attending">Attending</option>
            <option value="declined">Declined</option>
          </select>
          {fieldErrors.attendance_status ? (
            <small style={{ color: "crimson" }}>{fieldErrors.attendance_status}</small>
          ) : null}
        </label>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ display: "grid", gap: 6 }}>
            Name *
            <input
              name="name"
              value={form.name}
              onChange={onFormChange}
              placeholder="Your full name"
              style={inputStyle}
              disabled={isRsvpClosed}
            />
            {fieldErrors.name ? <small style={{ color: "crimson" }}>{fieldErrors.name}</small> : null}
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            Email (optional)
            <input
              name="email"
              value={form.email}
              onChange={onFormChange}
              placeholder="you@email.com"
              style={inputStyle}
              disabled={isRsvpClosed}
            />
            {fieldErrors.email ? <small style={{ color: "crimson" }}>{fieldErrors.email}</small> : null}
          </label>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          Phone (optional)
          <input
            name="phone"
            value={form.phone}
            onChange={onFormChange}
            placeholder="+65 9xxx xxxx"
            style={inputStyle}
            disabled={isRsvpClosed}
          />
          {fieldErrors.phone ? <small style={{ color: "crimson" }}>{fieldErrors.phone}</small> : null}
        </label>

        {sessions.length > 0 && form.attendance_status !== "declined" ? (
          <label style={{ display: "grid", gap: 6 }}>
            Session (optional)
            <select
              name="session_id"
              value={form.session_id}
              onChange={onFormChange}
              style={inputStyle}
              disabled={isRsvpClosed}
            >
              <option value="">No specific session</option>
              {sessions.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {formatSessionLabel(s)}
                </option>
              ))}
            </select>
          </label>
        ) : null}


        <label style={{ display: "grid", gap: 6 }}>
          Remarks (optional)
          <textarea
            name="remarks"
            value={form.remarks}
            onChange={onFormChange}
            placeholder={
              form.attendance_status === "declined"
                ? "No worries if you can't make it — you can still leave us a message 💛"
                : "Anything we should know?"
            }

            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
            disabled={isRsvpClosed}
          />
          {fieldErrors.remarks ? <small style={{ color: "crimson" }}>{fieldErrors.remarks}</small> : null}
        </label>

        {form.attendance_status === "declined" ? (
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              name="allow_public_share"
              checked={!!form.allow_public_share}
              onChange={onFormChange}
              disabled={isRsvpClosed}
              style={{ marginTop: 4 }}
            />
            <span style={{ fontSize: 14 }}>
              May share my message publicly (e.g., Instagram story) after the wedding.
            </span>
          </label>
        ) : null}


        {/* Future guest flow - keep hidden unless you want it visible
        <label style={{ display: "grid", gap: 6 }}>
          Invite Code (optional)
          <input
            name="invite_code"
            value={form.invite_code}
            onChange={onFormChange}
            placeholder="ABC123"
            style={inputStyle}
            disabled={isRsvpClosed}
          />
          {fieldErrors.invite_code ? <small style={{ color: "crimson" }}>{fieldErrors.invite_code}</small> : null}
        </label>
        */}

        <button type="submit" disabled={!canSubmit} style={{ ...btnStyle, opacity: canSubmit ? 1 : 0.6 }}>
          {isRsvpClosed ? "RSVP Closed" : submitting ? "Submitting…" : "Submit RSVP"}
        </button>
      </form>
    </div>
  );
}

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d9ddec",
  outline: "none",
  fontSize: 14,
};

const btnStyle = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "none",
  fontSize: 15,
  cursor: "pointer",
};
