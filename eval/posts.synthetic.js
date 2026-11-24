// SYNTHETIC labelled posts for the hiring-intent scorer. Invented text only; not LinkedIn data.
// Label: 'H' = the author (or the post they share) is announcing roles they are hiring for; 'N' = anything else.
// Category explains the kind of post. `amb: true` marks posts where a reasonable reader could label either way;
// the harness reports metrics with and without them.
// CAVEAT: the same author wrote this set and the scorer, so the numbers are optimistic and not a field estimate.

/** @typedef {{id: number, label: 'H'|'N', category: string, text: string, reshared_text?: string, amb?: boolean}} EvalPost */

const R = (label, category, text, extra = {}) => ({ label, category, text, ...extra });

const RAW = [
  // ---- direct hiring posts (varied sectors, places, levels) ----
  R('H', 'hiring_direct', "We're hiring a junior product designer in Lisbon. Apply via the link in comments."),
  R('H', 'hiring_direct', 'My team is hiring two backend engineers, remote across EU time zones. DM me if interested.'),
  R('H', 'hiring_direct', 'We are hiring an ICU nurse for night shifts at our Leeds hospital. Full job description below.'),
  R('H', 'hiring_direct', 'Now hiring: line cooks and a sous chef for our new restaurant opening in March. #hiring'),
  R('H', 'hiring_direct', 'Our lab is looking for a PhD student to join our group working on coral reef ecology. Applications are open until 1 Feb.'),
  R('H', 'hiring_direct', "I'm hiring a Chief of Staff. You'll work directly with me on strategy and operations. Link to apply in the first comment."),
  R('H', 'hiring_direct', 'Hiring a part-time bookkeeper, 10 hours a week, fully remote. Message me for details.'),
  R('H', 'hiring_direct', 'We have an open role for a senior data scientist on the pricing team. Salary range 140-170k plus equity.'),
  R('H', 'hiring_direct', 'Join our team! We need a warehouse supervisor for the Rotterdam site. Shifts rotate weekly.'),
  R('H', 'hiring_direct', '#hiring Electrician apprentices wanted in Brisbane. No experience needed, we train you. Apply now.'),
  R('H', 'hiring_direct', 'The team is growing and we are hiring a customer success manager for our APAC clients.'),
  R('H', 'hiring_direct', 'We are hiring a high school maths teacher starting next term. Know someone who would be a great fit? Tag them.'),
  R('H', 'hiring_direct', "We're hiring 3 software engineering interns for summer. Applications open now."),
  R('H', 'hiring_direct', 'Looking for an experienced paralegal to join our litigation practice in Toronto. Send your CV to the address on our careers page.'),
  R('H', 'hiring_direct', "We're expanding our team in Nairobi and hiring a finance manager. Details and application link below."),
  R('H', 'hiring_direct', 'Hiring for a Head of Marketing at an early-stage climate startup. Reach out to me if you want the full JD.'),
  R('H', 'hiring_direct', 'Our clinic is hiring a receptionist, 4 days a week. Benefits include health cover and free parking.'),
  R('H', 'hiring_direct', "We're hiring! Open positions: QA engineer, mobile developer, and technical writer. See our careers page."),
  R('H', 'hiring_direct', 'I am hiring a research assistant for a 12-month project on rural healthcare access. Apply here before Friday.'),
  R('H', 'hiring_direct', 'New role on my team: Staff Product Manager for payments. Hybrid in Berlin. DM me if you are interested.'),
  R('H', 'hiring_direct', "We're hiring a bilingual (Spanish/English) support agent. Remote, US hours. Apply through our site."),
  R('H', 'hiring_direct', 'Our studio is hiring a 3D animator for a 6-month contract. Portfolio required; share your portfolio with us.'),
  R('H', 'hiring_direct', 'We are now hiring delivery drivers for the holiday season. Weekly pay, flexible shifts.'),
  R('H', 'hiring_direct', 'Hiring: a VP of Sales to build our enterprise team from scratch. Compensation is competitive with meaningful equity.'),
  R('H', 'hiring_direct', "We're looking for a pharmacist to join our community pharmacy in Leeds. Full-time, weekends rotated."),
  R('H', 'hiring_direct', 'The city library is hiring a children\'s programme coordinator. Application link in comments.'),
  R('H', 'hiring_direct', 'We are hiring a DevOps engineer to own our CI/CD and cloud costs. Remote-friendly within GMT±3.'),
  R('H', 'hiring_direct', 'Excited to say my team is hiring a UX researcher! Full description in the link.'),
  R('H', 'hiring_direct', "We're hiring a grant writer for our nonprofit. Part-time, flexible, mission-driven team."),
  R('H', 'hiring_direct', 'Open headcount on our security team: two incident responders. Apply below or ping me for details.'),
  R('H', 'hiring_direct', 'Our hotel is hiring front desk staff and housekeeping for the summer season. Walk-in interviews on Saturday.'),
  R('H', 'hiring_direct', 'We are hiring a structural engineer (chartered) for bridge projects. Relocation support offered.'),
  R('H', 'hiring_direct', "I'm looking for a freelance copywriter to help launch our new product line. DM me if you have B2B experience."),
  R('H', 'hiring_direct', 'Hiring a dental hygienist, Tuesday to Friday. Great team, modern clinic. Send your resume.'),
  R('H', 'hiring_direct', "We're building out our data team and hiring an analytics engineer. Stack: dbt, SQL, Python."),
  R('H', 'hiring_direct', 'Our school is hiring teaching assistants for the new year. Applications are open now.'),
  R('H', 'hiring_direct', 'We need a payroll specialist for our Manila office. Join our team and help 2,000 colleagues get paid on time.'),
  R('H', 'hiring_direct', 'Now hiring a farm manager for our 400-hectare dairy operation. Housing provided.'),
  R('H', 'hiring_direct', 'We are hiring an executive assistant to support our CEO. Must be organised and calm under pressure. Apply here.'),
  R('H', 'hiring_direct', "My company is hiring a machine learning engineer in São Paulo. If you know someone, please share."),
  R('H', 'hiring_direct', 'Two vacancies on our care team: support workers for residential care, day and night shifts.'),
  R('H', 'hiring_direct', 'Come work with us! We need a solicitor with property experience. Message me for the full role details.'),
  R('H', 'hiring_direct', 'We are recruiting a policy advisor for the energy transition unit. Closing date 12 January.'),
  R('H', 'hiring_direct', 'Our bakery needs an early-morning baker. 5am starts, great coffee, good pay.'),
  R('H', 'hiring_direct', 'Hiring a sound engineer for a touring production next spring. Reach out if interested.'),

  // ---- reposts of hiring posts (labelled by what is being shared) ----
  R('H', 'hiring_repost', 'Great team, highly recommend applying!', { reshared_text: "We're hiring a product designer to join our team in Lisbon. Apply here." }),
  R('H', 'hiring_repost', 'Sharing for visibility. This is a wonderful place to work.', { reshared_text: 'We are hiring a staff nurse for our paediatric ward. Applications are open.' }),
  R('H', 'hiring_repost', 'My old manager is hiring, she is the best.', { reshared_text: 'My team is hiring a data engineer, remote in Canada. DM me if interested.' }),
  R('H', 'hiring_repost', 'Boosting this.', { reshared_text: '#hiring Join our team as an operations coordinator in Dubai. Apply via the link.' }),
  R('H', 'hiring_repost', '', { reshared_text: 'Now hiring: forklift operators, all shifts. Walk-in interviews Monday.' }),
  R('H', 'hiring_repost', 'If you know a strong React developer, send them this.', { reshared_text: "We're hiring a frontend engineer. Salary range 90-110k." }),
  R('H', 'hiring_repost', 'Proud of what this team is building. Go apply.', { reshared_text: 'Our team is growing! We are hiring two account executives.' }),
  R('H', 'hiring_repost', 'Repost for my network in Manchester.', { reshared_text: 'We are hiring a site manager for a residential build. Full job description in comments.' }),

  // ---- job seekers (hard negatives) ----
  R('N', 'seeker', "#OpenToWork After 6 years in logistics I'm looking for a new role in operations. Any leads appreciated."),
  R('N', 'seeker', 'I was laid off last week along with 200 colleagues. If your team is hiring, I would be grateful for a referral.'),
  R('N', 'seeker', "I'm actively looking for a job as a backend developer. Open to remote or relocation."),
  R('N', 'seeker', 'Is anyone hiring junior accountants in Melbourne? Asking for myself.'),
  R('N', 'seeker', "Who's hiring product managers right now? I'd love to chat."),
  R('N', 'seeker', 'After 10 great years I am seeking new opportunities in supply chain leadership.'),
  R('N', 'seeker', 'Open to work: experienced ICU nurse relocating to Wellington in February.'),
  R('N', 'seeker', "I'm looking for my next challenge in UX research. Please refer me if you see something."),
  R('N', 'seeker', 'Unfortunately I was impacted by the recent layoffs. I am currently looking for a role in sales.'),
  R('N', 'seeker', 'Recent graduate here, searching for a position in environmental engineering. Any advice welcome.'),
  R('N', 'seeker', 'Hi network, I am looking for work as a carpenter in the Midlands. Any leads?'),
  R('N', 'seeker', 'My contract ends next month and I am now looking for my next role in data analytics. #opentowork'),
  R('N', 'seeker', 'Seeking my next opportunity as a chef de partie. 8 years in fine dining.'),
  R('N', 'seeker', "I'm open to new opportunities in cybersecurity. Happy to connect with hiring managers."),
  R('N', 'seeker', "Day 90 of my job search. I've applied to 300 roles. Still looking for a job in marketing."),
  R('N', 'seeker', 'Any recruiters here? I am looking for a full-time role in HR.'),
  R('N', 'seeker', 'Looking for a job in Berlin as a German-English translator. Please share if you know anything.'),
  R('N', 'seeker', 'Hey everyone, I got let go today. Not sure what is next, but I am open to work.'),

  // ---- engagement bait ----
  R('N', 'bait', "Comment 'interested' and I'll send you 50 remote jobs hiring right now!"),
  R('N', 'bait', 'Companies hiring this week: Google, Amazon, Meta. Like and share so your network sees it.'),
  R('N', 'bait', 'Want a job in tech? Comment YES and follow me for more.'),
  R('N', 'bait', 'Hiring is broken. Agree?'),
  R('N', 'bait', 'Type "job" in the comments and I will DM you my list of companies hiring.'),
  R('N', 'bait', 'Recruiters never read cover letters. Thoughts?'),
  R('N', 'bait', '100 companies hiring remotely. Repost and comment to get the list.'),
  R('N', 'bait', 'Drop a 🔥 if you are job hunting. Follow me for more daily job lists.'),
  R('N', 'bait', 'Comment "CV" and I will review your resume for free. Hiring managers love this one trick.'),
  R('N', 'bait', 'Who else thinks 4-day weeks should be standard? Agree?'),

  // ---- agency / volume posts ----
  R('N', 'agency', 'Our client, a fast-growing fintech, is hiring across multiple roles. 40+ openings across Europe. Send your CV.'),
  R('N', 'agency', 'We place nurses in hospitals across the UK. Hundreds of jobs available this month. DM us.'),
  R('N', 'agency', 'Recruitment agency here: multiple clients hiring Java developers. Send your resume to apply.'),
  R('N', 'agency', 'On behalf of our client we are looking for 25 warehouse operatives. Temp to perm.'),
  R('N', 'agency', 'We have 50+ positions across logistics, retail and hospitality. Register with our staffing agency today.'),
  R('N', 'agency', 'Our clients are hiring! Check our job board for 300 new roles this week.'),
  R('N', 'agency', 'Staffing firm with exclusive roles for senior engineers at top startups. Share your CV in DMs.'),
  R('N', 'agency', 'We are a recruitment agency hiring for our client, a global bank: compliance analysts, 10 openings.', { amb: true }),

  // ---- new-job announcements ----
  R('N', 'new_job', "I'm happy to share that I'm starting a new position as Head of Finance at Example Co!"),
  R('N', 'new_job', 'Thrilled to announce I have joined Example Health as a nurse practitioner.'),
  R('N', 'new_job', 'Excited to share that I have accepted an offer at a design studio in Copenhagen.'),
  R('N', 'new_job', 'Starting a new position as a lecturer this week. Grateful to everyone who helped.'),
  R('N', 'new_job', 'Proud to announce that I joined the platform team today.'),
  R('N', 'new_job', "Excited to share that I've started a new position as Head of Nursing! The team is hiring too, more soon.", { amb: true }),
  R('N', 'new_job', 'New chapter: I am joining a climate startup as their first engineer.'),

  // ---- commentary, advice and news about hiring ----
  R('N', 'commentary', 'Hiring managers should stop asking for 10 years of experience in a 5-year-old tool.'),
  R('N', 'commentary', 'Hiring freeze at most firms I talk to. Here is what candidates can do instead.'),
  R('N', 'commentary', 'Five tips for job seekers writing their first CV.'),
  R('N', 'commentary', 'Recruiters need to give feedback after final interviews. It is basic respect.'),
  R('N', 'commentary', 'Layoffs hit the games industry again this quarter. Thinking of everyone affected.'),
  R('N', 'commentary', 'How to get hired without a degree: a thread.'),
  R('N', 'commentary', 'I was ghosted by three companies after final rounds. The hiring process is broken.'),
  R('N', 'commentary', 'Our quarterly survey: hiring has slowed down across mid-size firms in the region.'),
  R('N', 'commentary', 'Interviewing tip: ask what success looks like in the first 90 days.'),
  R('N', 'commentary', 'Employers must post salary ranges. It saves everyone time.'),
  R('N', 'commentary', 'Lessons from running 200 technical interviews last year.'),

  // ---- past hires and filled roles ----
  R('N', 'past_hire', 'Please welcome our newest teammate to the support team!'),
  R('N', 'past_hire', 'We just hired our 100th employee. What a journey.'),
  R('N', 'past_hire', 'Update: the role has been filled. Thank you to everyone who applied.'),
  R('N', 'past_hire', 'Welcome to the team, Sam! So glad you are here.'),
  R('N', 'past_hire', 'The position is now closed. We received over 400 applications.'),

  // ---- reposts of non-hiring content ----
  R('N', 'repost_other', 'Worth a read if you are hiring engineers.', { reshared_text: 'Five things I learned running technical interviews this year.' }),
  R('N', 'repost_other', 'So true.', { reshared_text: 'Hiring managers should read every cover letter. Agree?' }),
  R('N', 'repost_other', 'Congrats to my former colleague!', { reshared_text: "Thrilled to announce I've joined Example Bank as CFO." }),
  R('N', 'repost_other', 'Sharing to help a friend.', { reshared_text: "#OpenToWork I'm looking for a new role in logistics." }),
  R('N', 'repost_other', '', { reshared_text: 'Our annual report is out. Revenue grew 12% this year.' }),

  // ---- unrelated ----
  R('N', 'unrelated', 'A quiet morning by the river before the week starts.'),
  R('N', 'unrelated', 'Three charts on interest rates that surprised me this quarter.'),
  R('N', 'unrelated', 'Happy 10th birthday to our clinic!'),
  R('N', 'unrelated', 'We shipped dark mode. Took longer than we thought.'),
  R('N', 'unrelated', 'Speaking at a conference in Singapore next month on supply chain resilience.'),
  R('N', 'unrelated', 'Our team volunteered at the food bank today. Proud of everyone.'),
  R('N', 'unrelated', 'New blog post: why we moved our database to Postgres.'),
  R('N', 'unrelated', 'Book recommendation: a history of the shipping container.'),
  R('N', 'unrelated', 'Grateful for 5 years at this company.'),
  R('N', 'unrelated', 'Quarterly results are in and we beat our target.'),
  R('N', 'unrelated', 'Join our webinar on Thursday about tax changes for small businesses.'),
  R('N', 'unrelated', 'Join our team at the charity run this Saturday! Everyone welcome.', { amb: true }),

  // ---- ambiguous ----
  R('H', 'ambiguous', 'Big things coming in 2027. We will be growing the team soon, watch this space.', { amb: true }),
  R('H', 'ambiguous', 'If you are #OpenToWork and have warehouse experience, we are hiring forklift drivers.', { amb: true }),
  R('N', 'ambiguous', 'Referrals welcome! I am trying to fill my calendar with coaching clients.', { amb: true }),
  R('H', 'ambiguous', 'Anyone know a great bookkeeper? We need one for our small business.', { amb: true }),
  R('H', 'ambiguous', 'Hiring update: interviews this week, still accepting applications until Friday.', { amb: true }),
  R('N', 'ambiguous', 'Hiring is the most important thing a founder does. Here is how we do it.', { amb: true }),
  R('H', 'ambiguous', "We need help! Looking for someone who knows Excel to tidy our inventory sheets. Paid gig.", { amb: true }),
  R('N', 'ambiguous', 'Looking for a co-founder with sales experience for my side project. Equity only.', { amb: true }),
  R('H', 'ambiguous', 'Our partner school in Lagos needs volunteer and paid tutors. Message me.', { amb: true }),
  R('N', 'ambiguous', 'We are hiring... just kidding. But we are looking for feedback on our new app!', { amb: true }),
  R('H', 'ambiguous', 'Careers page is live. Five roles listed so far.', { amb: true }),
  R('N', 'ambiguous', 'Thinking about hiring my first employee. What should I know?', { amb: true }),
  R('H', 'ambiguous', 'Got budget approved for two more engineers on my team 🎉 more details next week.', { amb: true }),
  R('N', 'ambiguous', 'Freelancers: I have too much work this month and am happy to refer overflow.', { amb: true }),
  R('H', 'ambiguous', 'Vacancy: practice manager. See link.', { amb: true }),
];

// HELD-OUT: written after the scorer's one tuning pass, and not used to tune it.
// Small, so treat its numbers as a sanity check only.
const HELDOUT = [
  R('H', 'hiring_direct', 'Our physiotherapy practice is hiring a sports physio, 0.8 FTE. Apply by emailing the clinic.'),
  R('H', 'hiring_direct', "We're recruiting a site reliability lead. Hybrid in Dublin; salary and equity on request."),
  R('H', 'hiring_direct', 'Looking for a bilingual events coordinator to join our Montréal office. Details in the comments.'),
  R('H', 'hiring_direct', 'Two new roles on my team: platform engineer and engineering manager. DM me if you want the descriptions.'),
  R('H', 'hiring_direct', 'Our council is hiring a parks ranger. Closing date 30 January.'),
  R('H', 'hiring_direct', 'We need a part-time barista for weekends. Pop in and ask for Jo.'),
  R('H', 'hiring_repost', 'A brilliant team, share with anyone suitable.', { reshared_text: 'We are hiring a midwife for our birthing unit. Apply via the link.' }),
  R('N', 'seeker', "I'm currently seeking a role as an aircraft maintenance engineer. Open to relocation. #opentowork"),
  R('N', 'seeker', 'Anyone hiring graduate architects in Cape Town? Portfolio ready.'),
  R('N', 'bait', 'Companies hiring now: comment "list" and I will send it.'),
  R('N', 'agency', 'Our clients are hiring 30+ accountants across the region. Send your CV to our recruitment agency.'),
  R('N', 'new_job', 'Happy to share I have started a new position as a site engineer.'),
  R('N', 'commentary', 'Employers should stop unpaid take-home tests. It wastes candidates\' weekends.'),
  R('N', 'unrelated', 'Visited our supplier in Vietnam this week. Great to meet the team in person.'),
].map((p) => ({ ...p, heldout: true }));

/** @type {EvalPost[]} */
export const EVAL_POSTS = [...RAW, ...HELDOUT].map((p, i) => ({ id: i + 1, synthetic: true, heldout: false, ...p }));
