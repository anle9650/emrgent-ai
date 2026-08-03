// Transcripts written for THIS eval, not clinical corpus.
//
// Every other row splices real transcripts out of tests/evals/scribe/cases.ts,
// which gives exact ground-truth boundaries for free. Three properties of
// SPLIT_DETECTION_INSTRUCTIONS can't be reached that way, because splicing can
// only ever produce "two visits, each with a named patient":
//
//   1. a named non-patient in the room (caregiver / nurse / interpreter) — the
//      prompt's headline "NOT a new visit" rule
//   2. handoff language inside a single visit, which pits that rule directly
//      against the "explicit handoff talk" split rule
//   3. a real second visit whose patient is never named, where the correct
//      label is "" and any name at all is a hallucination
//
// They only need to read as real ambulatory speech and clear MIN_SPLIT_WORDS.

/** Eleanor's visit with her daughter Claire, who is greeted at the door by
 * name, speaks throughout, and is addressed directly. One visit: the PATIENT
 * never changes. This is the strongest false-split signal short of a real
 * boundary. */
export const CAREGIVER_PRESENT =
  "Good morning, Eleanor — and you must be Claire. Yes, I'm the daughter, I " +
  "drove her over. Nice to meet you, Claire, come on in, there's a chair " +
  "right there. Thank you. Mum, do you want me to hold your bag? I've got " +
  "it, I'm not helpless. Ha! All right, blood pressure is 128 over 78, that's " +
  "good. So how have the dizzy spells been? They come and go. Mostly when I " +
  "stand up too fast from the sofa. Claire, have you seen any of these — has " +
  "she been unsteady at home? A couple of times, yes. Last Tuesday she had to " +
  "grab the counter. I told her to tell you about it. I was going to. Any " +
  "falls, any actual loss of consciousness? No, nothing like that, I just " +
  "have to stand still a moment. And has she been sleeping and eating " +
  "normally, Claire? She's been sleeping fine. Eating maybe a bit less than " +
  "usual. That fits with what I'm hearing — this sounds like orthostatic " +
  "hypotension, your blood pressure dips for a moment when you stand. It's " +
  "very common. So what do we do? Stand up in two stages, sit on the edge of " +
  "the bed for a count of ten before you get up, and drink more water through " +
  "the day. Claire, if she does actually fall or blacks out, that's when you " +
  "call us, not before. Understood. I'll keep an eye on her. She fusses. I do " +
  "fuss. Let's see you back in three months. Thank you, Doctor. Thanks so " +
  "much for fitting us in.";

/** A nurse rooms the patient and hands off, and an interpreter relays for
 * him. One visit, even though it contains a literal handoff ("let me get the
 * doctor in") and two named non-patients. */
export const NURSE_HANDOFF_INTERPRETER =
  "Hello Mr. Okafor, I'm Dana, one of the nurses, I'm just going to get your " +
  "numbers before the doctor comes in. Yusuf, could you let him know I'm " +
  "going to check his blood pressure? He says that's fine. Blood pressure is " +
  "142 over 88, pulse 76, temperature is normal. All right, that's " +
  "everything — let me get the doctor in for you. Sorry to keep you waiting. " +
  "Dana tells me the pressure was a bit up today. Ask him how long the " +
  "headaches have been going on. He says about three weeks, mostly in the " +
  "morning, at the back of the head. And do they wake him from sleep? No, he " +
  "says they're there when he wakes up and they ease off by the afternoon. " +
  "Any visual changes, any weakness, any numbness? He says no to all of " +
  "those. Let me examine him. Neck is supple, no tenderness over the " +
  "temples, the neurological exam is normal. Yusuf, please tell him the " +
  "headaches are almost certainly coming from the blood pressure, not from " +
  "anything in the head. He understands. So we're going to start amlodipine, " +
  "five milligrams once a day, and I want him back in four weeks so Dana can " +
  "recheck the pressure. He asks if he should stop the ibuprofen he's been " +
  "taking. Yes — that can push the pressure up on its own. Paracetamol " +
  "instead. He says thank you very much, Doctor.";

/** A second visit whose patient is never named — no greeting by name, no
 * introduction. The boundary has to be found from the visit arc restarting.
 * Correct patientName for this segment is "", and any name the model emits is
 * invented. */
export const UNNAMED_SECOND_VISIT =
  "Come on in, have a seat. Sorry about the wait. That's all right. So " +
  "what's been going on? It's this cough. It started maybe three weeks ago " +
  "after that cold went through the house and it just hasn't packed up. Is " +
  "it bringing anything up? Not really, it's dry. It's worse at night, " +
  "that's the thing — I'm keeping my wife awake. Any fever, any chest pain, " +
  "any shortness of breath walking up stairs? No fever. No pain. I get a bit " +
  "puffed but no more than usual. Any wheeze? Sometimes at night, yes. Let " +
  "me listen. Deep breaths through the mouth for me. Chest is clear, no " +
  "crackles, a trace of wheeze at the bases on forced expiration. Your chest " +
  "sounds fine. This is a post-viral cough — the airways stay irritable for " +
  "weeks after the infection clears. It is not a chest infection and " +
  "antibiotics would do nothing for it. So I just put up with it? Mostly, " +
  "yes, and it does settle. Honey and warm water at night helps more than " +
  "anything you can buy. If it's still there in another three weeks, or if " +
  "you cough up blood or run a fever, come straight back and we'll get a " +
  "chest film. Fair enough. Thanks, Doctor.";
