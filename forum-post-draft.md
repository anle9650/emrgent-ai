# OpenEMR forum — drafts

Two pieces, meant to be posted in this order:

1. **Reply** in the existing Voice-to-Text thread — post this first.
2. **New topic** in OpenEMR Development — post a few days later.

---

# 1. Reply to "Voice-to-Text in OpenEMR: What's Possible Today?"

Thread: https://community.open-emr.org/t/voice-to-text-in-openemr-what-s-possible-today/25448

## Reply body

Coming to this thread late. I scribed for a few years before I moved into software, first in family medicine and then at an orthopedic clinic, so I have a slightly different angle than most of the posts above.

Almost everything discussed here is dictation. Dragon, DeepSpeech, Infeg's speech-to-text in the SOAP forms, Sherwin's STT attached to LBF textareas with the revise button. In all of those the doctor is still the author: they recall the visit, decide what matters, and say it out loud. @Nilesh_Hake's post is the exception, and recording the actual doctor-patient conversation is a different thing entirely.

The distinction: words were never the slow part. The slow part is recall and sorting: updating medications and problem lists, scheduling follow-up appointments, sending out referrals. Nobody dictates any of that. It's implied by the visit, and then someone does it by hand in five different parts of the chart, from memory, on the fourth patient of the afternoon. Dictation doesn't reach it by design. Ambient capture does, because the recording already contains the visit and the model can take a first pass at what mattered in it. That was most of what I was there for as a scribe. Nobody hired me because I typed quickly.

The catch is that it moves the trust problem. With dictation you're proofreading your own words. With ambient capture the model is inferring clinical content from a conversation full of hedging, patient self-report, things said and then walked back. And once you're writing to the problem list and the med list, a small error stops being a typo you fix and starts following the patient around for years. The solution: make every write show up as its own card with the exact fields visible. Commit nothing until the doc approves that specific card. Roughly the arrangement I worked under: I wrote, the doctor read it and signed it.

@Nilesh_Hake I'm curious how you handled that step. Did the doc review each prescription and CPT4/HCPCS code before it landed, or did it write through?

Two smaller practical things, in case they save someone time. Long visits need segmented recording: a 40-minute encounter as a single blob runs into request size limits and transcription file caps, so record in independently-decodable segments and transcribe each as it closes, which also keeps partial results if the tab dies. And vitals are where fabrication shows up first, so chart only what's actually in the transcript and leave the rest empty.

@dahalday, on privacy your approach is the more defensible one. Local Whisper plus Ollama means the audio never leaves the server, which sidesteps the BAA problem anything cloud-based has to answer for. I went the other way, cloud models for better output and much worse privacy.

I've been building an ambient scribe against the OpenEMR REST API along these lines. Free, AGPL, with a click-through demo against synthetic data. I'll write it up in its own thread rather than take over this one, but happy to answer anything here.

Andy

---

# 2. New topic — OpenEMR Development

**Category:** OpenEMR Development
**Tags:** `feature`, `api`

**Title:** An open-source ambient AI scribe built on the OpenEMR REST API — free, AGPL, looking for critique

## Post body

Hi all,

I scribed for a few years before moving into software, first in family medicine and then at an orthopedic clinic. The value wasn't that I typed quickly. It was that the doctor didn't have to hold the visit in their head and then sort it into the right parts of the chart afterward. Everything I wrote went to them to read and sign before it counted. Both halves of that are what I kept coming back to when people started building AI scribes.

Worth separating from dictation, which is what most of the OpenEMR discussion so far has been about. With dictation the doctor is still the author. An ambient scribe listens to the encounter itself and takes the first pass, which is a bigger help and a bigger trust problem at once.

So I built one, called EMRgent AI. You sign in with your OpenEMR account, pick a patient off the schedule, record the visit, and the agent proposes the chart work: an encounter with a SOAP note and whatever vitals were actually spoken aloud, problem list and medication reconciliation, referrals, the follow-up appointment, and a plain-language visit summary to the patient portal. Every write is gated behind an approval card showing the exact fields, approved or rejected one at a time. The model reads whatever it needs; it can't write on its own.

Demo you can click, no install: https://emrgent-ai.vercel.app/
Source: https://github.com/anle9650/emrgent-ai

The demo runs against a mock OpenEMR with synthetic patients, so you can continue as a guest and run a full session start to finish. There's a "use demo recording" button if you don't want to bother with a microphone.

I'm not selling anything. No company, no subscription, no support contract. It's AGPL, same as OpenEMR, and it's a nights-and-weekends project. I'm posting because I'd rather have people who work with OpenEMR every day tell me what's wrong with it than keep guessing. This picks up from the [voice-to-text thread](https://community.open-emr.org/t/voice-to-text-in-openemr-what-s-possible-today/25448), where @dahalday and others have been working the dictation side of this, and from the questions in [Exploring AI capabilities](https://community.open-emr.org/t/exploring-ai-capabilities-roadmap-and-community-strategy/26823) and [AI use in OpenEMR](https://community.open-emr.org/t/ai-use-in-openemr/25688). I'd rather add to those than start a parallel conversation.

It's also not ready for real PHI. Audio and transcripts go to a third-party model provider, so real patients would need a BAA and a serious look at the whole data path. Test data only for now. The local Whisper plus Ollama approach @dahalday took is the better answer there.

### How it talks to OpenEMR

It's a standalone web app rather than a module. Everything goes through the standard REST API over OAuth2, registering as an OIDC client, so calls carry the signed-in user's own token and inherit that user's permissions rather than running as a superuser. Reads: patients, encounters, SOAP notes, appointments, problem list, medications, surgeries. Writes: encounters, problems, medications, surgeries, appointments, portal messages, and referrals as transactions.

I went standalone partly because ambient recording wants a different kind of UI than a form inside the EMR, and partly because it means no changes to your install. I'm not sure that was right. It puts the whole thing outside the module ecosystem, outside the ACL UI, and outside whatever the project eventually decides about AI features. If people who've shipped modules here think that's worth revisiting, I'd like to hear it.

A few API things I hit, in case they're useful to anyone else building against it:

- I couldn't find an appointment *update* endpoint. Changing status means recreating the appointment and deleting the original. I do the recreate first, so a failure halfway through leaves a recoverable duplicate rather than a lost appointment. If there's a proper way to do this that I missed, I'd like to know.
- Encounter dates and `begdate` are stored as bare `YYYY-MM-DD` with no timezone. If your server runs in UTC and your doc is in the Americas in the evening, you quietly write tomorrow's date. Took me embarrassingly long to notice. Everything now anchors to the user's local calendar day.
- The OIDC provider doesn't echo `nonce`, so PKCE plus state is what worked.

### What I'd most like from this community

Does the chart output look right to people who use OpenEMR daily? I scribed in a different system, so I've probably made assumptions about the encounter and problem-list model that don't match real practice. Billing codes and orders are the two gaps I already know about. I'm more interested in the ones I don't.

Thanks for reading, and thanks for OpenEMR. Having a real EMR with a real API I could stand up locally is the only reason one person could build this at all.

Andy
