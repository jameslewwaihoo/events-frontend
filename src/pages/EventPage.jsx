import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import "./EventPage.css";

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
  const [envelopeOpened, setEnvelopeOpened] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);
  const sectionRefs = useRef([]);
  const setSectionRef = (idx) => (el) => {
    sectionRefs.current[idx] = el;
  };
  const [countdown, setCountdown] = useState({ days: "--", hours: "--", minutes: "--", seconds: "--" });
  const snapTimeout = useRef(null);
  const snapAnimation = useRef(null);
  const isSnapping = useRef(false);
  const roses = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 6,
        duration: 8 + Math.random() * 8,
        size: 28 + Math.random() * 18,
        img: i % 2 === 0 ? "/images/red-rose.png" : "/images/white-rose.png",
      })),
    []
  );
  const loveImages = useMemo(
    () => [
      "/images/love/IMG_0895.JPG",
      "/images/love/IMG_0896.JPG",
      "/images/love/IMG_0897.JPG",
      "/images/love/IMG_4720.JPG",
    ],
    []
  );
  const loopedLoveImages = useMemo(
    () => [...loveImages, ...loveImages, ...loveImages],
    [loveImages]
  );
  const sliderRef = useRef(null);
  const slideRefs = useRef([]);
  const setSlideRef = (idx) => (el) => {
    slideRefs.current[idx] = el;
  };
  const [activeSlide, setActiveSlide] = useState(0);
  const activeImage = loveImages[activeSlide % loveImages.length] || loveImages[0];
  const sliderSectionRef = useRef(null);
  const sliderThird = useRef(0);
  const sliderInteracting = useRef(false);
  const sliderAutoRaf = useRef(null);

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

        const res = await apiFetch(`/public/events/${slug}`, { signal: controller.signal });

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

  useEffect(() => {
    // no-op: reserved for future global listeners
  }, []);

  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;

    let isDown = false;
    let startX = 0;
    let scrollStart = 0;
    let lastX = 0;
    let velocity = 0;
    let inertiaRaf = null;
    let third = 0;

    const recalcBounds = () => {
      third = el.scrollWidth / 3;
      sliderThird.current = third;
      el.scrollLeft = third;
    };

    const onDown = (e) => {
      isDown = true;
      startX = e.clientX;
      scrollStart = el.scrollLeft;
      el.classList.add("dragging");
      lastX = e.clientX;
      velocity = 0;
      sliderInteracting.current = true;
      if (inertiaRaf) {
        cancelAnimationFrame(inertiaRaf);
        inertiaRaf = null;
      }
    };

    const onMove = (e) => {
      if (!isDown) return;
      const dx = e.clientX - startX;
      el.scrollLeft = scrollStart - dx;
      velocity = e.clientX - lastX;
      lastX = e.clientX;
      if (el.scrollLeft < third * 0.3) {
        el.scrollLeft += third;
      } else if (el.scrollLeft > third * 1.7) {
        el.scrollLeft -= third;
      }
    };

    const onUp = () => {
      isDown = false;
      el.classList.remove("dragging");
      sliderInteracting.current = false;
      const decay = 0.985;
      const maxStep = 60;
      const step = () => {
        if (Math.abs(velocity) < 0.08) {
          inertiaRaf = null;
          return;
        }
        const stepVel = Math.max(Math.min(velocity, maxStep), -maxStep);
        el.scrollLeft -= stepVel;
        if (el.scrollLeft < third * 0.3) {
          el.scrollLeft += third;
        } else if (el.scrollLeft > third * 1.7) {
          el.scrollLeft -= third;
        }
        velocity *= decay;
        inertiaRaf = requestAnimationFrame(step);
      };
      inertiaRaf = requestAnimationFrame(step);
    };

    recalcBounds();

      el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointerleave", onUp);
    window.addEventListener("resize", recalcBounds);

    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointerleave", onUp);
      window.removeEventListener("resize", recalcBounds);
      if (inertiaRaf) cancelAnimationFrame(inertiaRaf);
    };
  }, [loopedLoveImages.length]);

  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;

    const computeActive = () => {
      const center = el.scrollLeft + el.clientWidth / 2;
      let nearestIdx = 0;
      let nearestDiff = Infinity;
      slideRefs.current.forEach((node, idx) => {
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const slideCenter = rect.left + rect.width / 2 + el.scrollLeft - el.getBoundingClientRect().left;
        const diff = Math.abs(slideCenter - center);
        if (diff < nearestDiff) {
          nearestDiff = diff;
          nearestIdx = idx;
        }
      });
      const normalized = nearestIdx % loveImages.length;
      setActiveSlide(normalized);
    };

    computeActive();
    const onScroll = () => computeActive();
    const onResize = () => computeActive();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // auto-scroll disabled; drag only

  useEffect(() => {
    if (!contentVisible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("is-visible");
          else entry.target.classList.remove("is-visible");
        });
      },
      { threshold: 0.45, rootMargin: "-10% 0px" }
    );

    sectionRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [contentVisible, sectionRefs]);

  const smoothScrollTo = (targetY, duration = 900) => {
    if (snapAnimation.current) cancelAnimationFrame(snapAnimation.current);
    const startY = window.scrollY || window.pageYOffset;
    const diff = targetY - startY;
    const start = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t); // easeInOutQuad

    const step = (now) => {
      const elapsed = Math.min((now - start) / duration, 1);
      const eased = ease(elapsed);
      window.scrollTo(0, startY + diff * eased);
      if (elapsed < 1) {
        snapAnimation.current = requestAnimationFrame(step);
      }
    };

    snapAnimation.current = requestAnimationFrame(step);
  };


  useEffect(() => {
    if (!contentVisible) return;

    const handleScroll = () => {
      // Auto snap disabled
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (snapTimeout.current) clearTimeout(snapTimeout.current);
      if (snapAnimation.current) cancelAnimationFrame(snapAnimation.current);
    };
  }, [contentVisible, sectionRefs]);

  useEffect(() => {
    if (!event?.event_date) return;
    const target = new Date(event.event_date);

    const updateCountdown = () => {
      const now = new Date();
      const diff = target - now;
      if (diff <= 0) {
        setCountdown({ days: "00", hours: "00", minutes: "00", seconds: "00" });
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);
      setCountdown({
        days: String(days).padStart(2, "0"),
        hours: String(hours).padStart(2, "0"),
        minutes: String(minutes).padStart(2, "0"),
        seconds: String(seconds).padStart(2, "0"),
      });
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [event?.event_date, contentVisible]);


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
      const res = await apiFetch(`/public/events/${encodeURIComponent(slug)}/rsvp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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

      const res = await apiFetch(`/public/events/${encodeURIComponent(slug)}/rsvp?` + params.toString());

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

  function onOpenEnvelope() {
    if (envelopeOpened) return;
    setEnvelopeOpened(true);
    setTimeout(() => {
      setContentVisible(true);
      setTimeout(() => {
        const target = sliderSectionRef.current || sectionRefs.current[0];
        if (target) {
          const targetY = target.offsetTop + target.offsetHeight / 2 - window.innerHeight / 2;
          smoothScrollTo(targetY, 800);
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        setTimeout(() => setOverlayVisible(false), 300);
      }, 120);
    }, 1000);
  }


  return (
    <div className="event-page">
      <div className="rose-field" aria-hidden="true">
        {roses.map((rose) => (
          <span
            key={rose.id}
            className="rose"
            style={{
              "--left": `${rose.left}%`,
              "--delay": `${rose.delay}s`,
              "--duration": `${rose.duration}s`,
              "--size": `${rose.size}px`,
              "--img": `url(${rose.img})`,
            }}
          >
            <span className="rose__img" />
          </span>
        ))}
      </div>

      <div className={`invite-overlay ${overlayVisible ? "" : "invite-overlay--hide"}`}>
        <div className="invite-overlay__inner">
          <p className="eyebrow">Open invitation</p>
          <h2 className="overlay-title">{event?.title || "You’re invited"}</h2>
          <p className="muted overlay-sub">
            Tap the envelope to reveal the details and confirm your attendance.
          </p>
          <div className={`envelope-photo ${envelopeOpened ? "open" : ""}`} onClick={onOpenEnvelope} aria-label="Envelope invitation" />
        </div>
      </div>

      <div className={`event-page__shell page-content ${contentVisible ? "page-content--show" : ""}`}>
        <div className="page-sections">
          <section className="full-section slider-section" ref={sliderSectionRef}>
            <div className="slider-head">
              <p className="eyebrow">A growing toolkit for creative developers</p>
              <h2 className="section-title">Memories to play with</h2>
              <p className="muted">Drag these to explore the mood.</p>
            </div>
            <div className="love-preview">
              <img className="love-preview__img" src={activeImage} alt="Preview" loading="lazy" />
            </div>
              <div className="love-slider" data-gsap-slider-list ref={sliderRef}>
              {loopedLoveImages.map((src, idx) => {
                const loopLen = loopedLoveImages.length;
                const targetIndex = loveImages.length + activeSlide; // center copy
                let offset = idx - targetIndex;
                const half = loopLen / 2;
                if (offset > half) offset -= loopLen;
                if (offset < -half) offset += loopLen;

                let stateClass = "is-rest";
                if (offset === 0) stateClass = "is-active";
                else if (offset === -1) stateClass = "is-left";
                else if (offset === 1) stateClass = "is-right";

                return (
                  <div
                    className={`love-slide ${stateClass}`}
                    key={src + idx}
                    style={{ backgroundImage: `url(${src})`, "--offset": offset }}
                    ref={setSlideRef(idx)}
                  >
                    <div className="love-slide__overlay" />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="full-section" ref={setSectionRef(0)}>
            <header className="hero surface">
              <div className="eyebrow">You&apos;re invited</div>
              <div className="hero__title-wrap">
                <h1 className="hero__title">{event?.title || "Event"}</h1>
                {event?.welcome_message ? <p className="muted">{event.welcome_message}</p> : null}
              </div>

              <div className="info-grid">
                {event?.event_date ? (
                  <div className="info-item">
                    <span className="label">Date</span>
                    <span className="value">{event.event_date}</span>
                  </div>
                ) : null}

                {event?.venue_name ? (
                  <div className="info-item">
                    <span className="label">Venue</span>
                    <span className="value">{event.venue_name}</span>
                  </div>
                ) : null}

                {event?.venue_address ? (
                  <div className="info-item">
                    <span className="label">Address</span>
                    <span className="value">
                      {event.venue_address}{" "}
                      {event?.venue_map_url ? (
                        <a href={event.venue_map_url} target="_blank" rel="noreferrer" className="link">
                          · Map
                        </a>
                      ) : null}
                    </span>
                  </div>
                ) : null}

                {event?.rsvp_deadline ? (
                  <div className="info-item">
                    <span className="label">RSVP deadline (GMT+8)</span>
                    <span className="value">{event.rsvp_deadline}</span>
                  </div>
                ) : null}
              </div>
              {event?.event_date ? (
                <div className="countdown">
                  <div className="countdown__item">
                    <div className="countdown__value">{countdown.days}</div>
                    <div className="countdown__label">Days</div>
                  </div>
                  <div className="countdown__item">
                    <div className="countdown__value">{countdown.hours}</div>
                    <div className="countdown__label">Hours</div>
                  </div>
                  <div className="countdown__item">
                    <div className="countdown__value">{countdown.minutes}</div>
                    <div className="countdown__label">Minutes</div>
                  </div>
                  <div className="countdown__item">
                    <div className="countdown__value">{countdown.seconds}</div>
                    <div className="countdown__label">Seconds</div>
                  </div>
                </div>
              ) : null}
            </header>
          </section>

          <section className="full-section" ref={setSectionRef(1)}>
            <div className="surface section-stack">
              <div className="section-head">
                <p className="eyebrow">Schedule</p>
                <h3 className="section-title">What&apos;s happening</h3>
              </div>
              {loading && <div className="alert notice">Loading…</div>}
              {err && <div className="alert danger">Error: {err}</div>}
              {!loading && !err && !event && (
                <div className="alert danger">
                  No event found for slug: <b>{slug}</b>
                </div>
              )}
              {event && sessions.length > 0 ? (
                <ul className="sessions">
                  {sessions.map((s) => (
                    <li key={s.id} className="session">
                      <div className="session__title">{formatSessionLabel(s)}</div>
                      {s.location ? <div className="session__meta">{s.location}</div> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Schedule details will be announced soon.</p>
              )}
            </div>
          </section>

          <section className="full-section" ref={setSectionRef(2)}>
            <div className="surface form-panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">RSVP</p>
                  <h3 className="section-title">Reserve your spot</h3>
                </div>
                <span className={`pill ${isRsvpClosed ? "pill--closed" : "pill--open"}`}>
                  {isRsvpClosed ? "Closed" : "Open"}
                </span>
              </div>

          {submitOk ? <div className="alert success">{submitOk}</div> : null}
          {submitErr ? <div className="alert danger">{submitErr}</div> : null}
          {isRsvpClosed ? (
            <div className="alert warning">
              RSVP is closed. (Deadline was <b>{event?.rsvp_deadline}</b>, GMT+8)
            </div>
          ) : null}

          <div className="panel-body">
            <div className="lookup">
              <p className="muted">Load your existing RSVP to edit it.</p>
              <div className="lookup__row">
                <input
                  value={lookupKey}
                  onChange={(e) => setLookupKey(e.target.value)}
                  placeholder="Enter email / phone / invite code"
                  className="input"
                  disabled={isRsvpClosed}
                />
                <button
                  type="button"
                  onClick={onLookupRsvp}
                  disabled={lookupLoading || isRsvpClosed}
                  className="btn secondary"
                >
                  {lookupLoading ? "Loading…" : "Find my RSVP"}
                </button>
              </div>
              {lookupMsg ? (
                <small className={lookupMsg.includes("✅") ? "hint success" : "hint danger"}>{lookupMsg}</small>
              ) : null}
            </div>

            <form onSubmit={onSubmitRSVP} className="rsvp-form">
              <label className="field">
                <span className="field__label">Attendance *</span>
                <select
                  name="attendance_status"
                  value={form.attendance_status}
                  onChange={onFormChange}
                  className="input"
                  disabled={isRsvpClosed}
                >
                  <option value="attending">Attending</option>
                  <option value="declined">Declined</option>
                </select>
                {fieldErrors.attendance_status ? <small className="hint danger">{fieldErrors.attendance_status}</small> : null}
              </label>

              <div className="grid-2">
                <label className="field">
                  <span className="field__label">Name *</span>
                  <input
                    name="name"
                    value={form.name}
                    onChange={onFormChange}
                    placeholder="Your full name"
                    className="input"
                    disabled={isRsvpClosed}
                  />
                  {fieldErrors.name ? <small className="hint danger">{fieldErrors.name}</small> : null}
                </label>

                <label className="field">
                  <span className="field__label">Email (optional)</span>
                  <input
                    name="email"
                    value={form.email}
                    onChange={onFormChange}
                    placeholder="you@email.com"
                    className="input"
                    disabled={isRsvpClosed}
                  />
                  {fieldErrors.email ? <small className="hint danger">{fieldErrors.email}</small> : null}
                </label>
              </div>

              <label className="field">
                <span className="field__label">Phone (optional)</span>
                <input
                  name="phone"
                  value={form.phone}
                  onChange={onFormChange}
                  placeholder="+65 9xxx xxxx"
                  className="input"
                  disabled={isRsvpClosed}
                />
                {fieldErrors.phone ? <small className="hint danger">{fieldErrors.phone}</small> : null}
              </label>

              {sessions.length > 0 && form.attendance_status !== "declined" ? (
                <label className="field">
                  <span className="field__label">Session (optional)</span>
                  <select
                    name="session_id"
                    value={form.session_id}
                    onChange={onFormChange}
                    className="input"
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

              <label className="field">
                <span className="field__label">Remarks (optional)</span>
                <textarea
                  name="remarks"
                  value={form.remarks}
                  onChange={onFormChange}
                  placeholder={
                    form.attendance_status === "declined"
                      ? "No worries if you can't make it — you can still leave us a message"
                      : "Anything we should know?"
                  }
                  rows={4}
                  className="input textarea"
                  disabled={isRsvpClosed}
                />
                {fieldErrors.remarks ? <small className="hint danger">{fieldErrors.remarks}</small> : null}
              </label>

              {form.attendance_status === "declined" ? (
                <label className="field checkbox">
                  <input
                    type="checkbox"
                    name="allow_public_share"
                    checked={!!form.allow_public_share}
                    onChange={onFormChange}
                    disabled={isRsvpClosed}
                  />
                  <span>May share my message publicly (e.g., Instagram story) after the wedding.</span>
                </label>
              ) : null}

              <button type="submit" disabled={!canSubmit} className="btn primary">
                {isRsvpClosed ? "RSVP Closed" : submitting ? "Submitting…" : "Submit RSVP"}
              </button>
            </form>
          </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
