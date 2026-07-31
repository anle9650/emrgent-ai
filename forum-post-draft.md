# OpenEMR forum — drafts

Two pieces, meant to be posted in this order:

1. **Reply** in the existing Voice-to-Text thread — post this first.
2. **New topic** in OpenEMR Development — post a few days later.

---

# 1. Reply to "Voice-to-Text in OpenEMR: What's Possible Today?"

Thread: https://community.open-emr.org/t/voice-to-text-in-openemr-what-s-possible-today/25448

## Reply body

Coming to this thread late. I scribed for a few years before I moved into software, first in family medicine and then at an orthopedic clinic, so I have a slightly different angle than most of the posts above.

One thing I noticed reading back through: almost everything discussed here is dictation. Dragon, DeepSpeech, Infeg's speech-to-text in the SOAP forms, Sherwin's STT attached to LBF textareas with the revise button. In all of those the physician is the author. They decide what goes in the note and say it out loud, and the tool transcribes and tidies. @Nilesh_Hake's post is the exception, since recording the actual doctor-patient conversation is a different thing entirely.

The difference is that with dictation, review is proofreading your own words. With ambient capture the model is inferring clinical content out of a conversation that contains hedging, patient self-report, things said and then walked back, and a fair amount of nothing.

So the practical problems are different too. A few things I ran into.

Transcription mostly isn't the hard part anymore. Whisper and Deepgram Nova-3 Medical are both fine. What's hard is that the note is the smallest piece of the work. Typing it was never the slow part of my day. The slow part was the problem list nobody had touched in two years, the med the patient stopped taking in March and didn't mention until you asked, the follow-up that needed to actually get on the schedule, and the referral that needed to go out before the patient left. It's all implied by the visit, and then somebody goes and does it in five different parts of the chart. That's the part I most wanted to automate, and it's the part dictation can't reach by design. I suspect it's also some of why Sherwin's clients used the revise-with-AI button less than he expected.

Which leads to the other problem: once you're writing to the problem list and the med list instead of a textarea, the stakes change. A model getting something slightly wrong in free text is a typo you fix. The same mistake in the problem list is a chart error that follows the patient around for years. What I ended up doing is making every write show up as its own card with the exact fields visible, and nothing commits until you approve that specific card. Which is roughly the arrangement I worked under as a scribe: I wrote, the physician read it and signed it. The failure mode isn't the model making things up, it's a clinician at 5:40pm clicking approve on nine cards without reading them.

@Nilesh_Hake I'm curious how you handled that step. Did the clinician review each prescription and CPT4/HCPCS codes before they landed, or did it write through?

Two smaller practical things, in case they save someone time:

Long visits need segmented recording. A 40-minute encounter as a single blob will run into request size limits and transcription file caps. Recording in independently-decodable segments and transcribing each one as it closes fixes that, and you keep partial results if the tab dies halfway through.

Vitals are where fabrication shows up first. Ask a model to fill in a vitals section and it will produce entirely plausible numbers that nobody said out loud. Chart only what's actually in the transcript and leave the rest empty.

@dahalday, on the privacy question your approach is the more defensible one. Local Whisper plus Ollama means the audio never leaves the server, which sidesteps the BAA problem that anything cloud-based has to answer for. I went the other direction, cloud models for better output and a much worse privacy story, and I'm honestly not sure I chose right.

For context on where I'm coming from, I've been building an ambient scribe against the OpenEMR REST API: it records the visit, then proposes the encounter, SOAP note, problem and med reconciliation, referrals, and the follow-up appointment as individually approved writes. Free, AGPL, and there's a demo you can click through against synthetic data. I'll write it up in its own thread rather than take over this one, but happy to answer anything here.

Andy

---

# 2. New topic — OpenEMR Development

**Category:** OpenEMR Development
**Tags:** `feature`, `api`

**Title:** An open-source ambient AI scribe built on the OpenEMR REST API — free, AGPL, looking for critique

## Post body

Hi all,

I scribed for a few years before moving into software, first in family medicine and then at an orthopedic clinic. Most of that job was sitting in the room, listening, and then turning what I'd heard into a note, a problem list update, a med change, and a follow-up appointment. Everything I wrote went to the physician to read and sign before it counted for anything. That last part is what I kept coming back to when people started building AI scribes.

So I built one for OpenEMR. It's called EMRgent AI. You sign in with your OpenEMR account, pick a patient off the schedule, record the visit, and the agent proposes the chart work: an encounter with a SOAP note and whatever vitals were actually spoken aloud, problem list and medication reconciliation, referrals, the follow-up appointment, and a plain-language visit summary to the patient portal. Every write is gated behind an approval card. You see the exact fields before anything touches the chart and you approve or reject each one individually. The model can read whatever it needs; it can't write on its own.

Demo you can click, no install: https://emrgent-ai.vercel.app/
Source: https://github.com/anle9650/emrgent-ai

The demo runs against a mock OpenEMR with synthetic patients, so you can continue as a guest and run a full session start to finish. There's a "use demo recording" button if you don't want to bother with a microphone.

Two things I want to say up front.

I'm not selling anything. No company, no subscription, no support contract. It's AGPL, same as OpenEMR, and it's a nights-and-weekends project. I'm posting because I'd rather have people who work with OpenEMR every day tell me what's wrong with it than keep guessing on my own. Some of this overlaps with what @dahalday shared in the [voice-to-text thread](https://community.open-emr.org/t/voice-to-text-in-openemr-what-s-possible-today/25448), and with the questions raised in [Exploring AI capabilities: Roadmap and community strategy](https://community.open-emr.org/t/exploring-ai-capabilities-roadmap-and-community-strategy/26823) and [AI use in OpenEMR](https://community.open-emr.org/t/ai-use-in-openemr/25688). I'd like to add to those conversations rather than start a parallel one.

It is also not ready for real PHI. Audio and transcripts go to a third-party model provider for transcription and reasoning, so using this on real patients would need a BAA and a serious look at the whole data path. Please point it at test data only for now. The local Whisper plus Ollama approach @dahalday took is the better answer on that front and I don't want to pretend otherwise.

### How it talks to OpenEMR

It's a standalone web app rather than a module. Everything goes through the standard REST API over OAuth2. It registers as an OIDC client, so calls carry the signed-in user's own token and inherit that user's permissions rather than running as a superuser. Reads: patients, encounters, SOAP notes, appointments, problem list, medications, surgeries. Writes: encounters, problems, medications, surgeries, appointments, portal messages, and referrals as transactions.

I went standalone partly because ambient recording wants a different kind of UI than a form inside the EMR, and partly because it means no changes to your install. I'm not sure that was the right call, though. It puts the whole thing outside the module ecosystem and outside the ACL UI, and outside whatever the project eventually decides about AI features generally. If people who've actually shipped modules here think that tradeoff is worth revisiting, I'd like to hear it.

A few API things I hit, in case they're useful to anyone else building against it:

- I couldn't find an appointment *update* endpoint. Changing an appointment's status means recreating it and deleting the original. I do the recreate first so that a failure halfway through leaves a recoverable duplicate rather than a lost appointment. If there's a proper way to do this that I missed, I'd like to know.
- Encounter dates and `begdate` values are stored as bare `YYYY-MM-DD` with no timezone. If your app server runs in UTC and your clinician is in the Americas in the evening, you quietly write tomorrow's date. Took me embarrassingly long to notice. Everything now anchors to the user's local calendar day.
- The OIDC provider doesn't echo `nonce`, so PKCE plus state is what worked.

### What I'd most like from this community

Does the chart output look right to people who use OpenEMR daily? I scribed in a different system and I'm sure I've made assumptions about the encounter and problem-list model that don't match how real practices work. Billing codes and orders are the two gaps I already know about. I'm more interested in the ones I don't.

Thanks for reading, and thanks for OpenEMR. Having a real EMR with a real API that I could stand up locally is the only reason one person could build this at all.

Andy
