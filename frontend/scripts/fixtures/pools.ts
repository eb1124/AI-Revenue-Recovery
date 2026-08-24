// Name / city / copy pools for fixture generation. Deliberately wide so 200
// customers don't collapse into a handful of repeats, and deliberately not
// Mumbai-only per the master spec's realism requirement (5.4 customers.city:
// "Weighted to metro/tier-2").

export const FIRST_NAMES = [
  // North / West leaning
  'Aarav', 'Vihaan', 'Aditya', 'Vivaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Rohan', 'Kabir', 'Aryan', 'Dhruv', 'Karan', 'Nikhil', 'Rahul', 'Amit', 'Rajesh', 'Vikram',
  'Manoj', 'Deepak', 'Sanjay', 'Anand', 'Gaurav', 'Varun', 'Siddharth', 'Abhishek', 'Naveen', 'Ashok',
  'Ananya', 'Diya', 'Ira', 'Myra', 'Sara', 'Aadhya', 'Kiara', 'Pari', 'Anika', 'Navya',
  'Meera', 'Priya', 'Kavya', 'Neha', 'Pooja', 'Sneha', 'Divya', 'Shreya', 'Nisha', 'Ritu',
  'Anjali', 'Sunita', 'Rekha', 'Radha', 'Kavita', 'Swati', 'Preeti', 'Aditi', 'Ishita', 'Riya',
  'Jhanvi', 'Aarushi', 'Deepika', 'Manisha', 'Rashmi', 'Sana', 'Farhan', 'Imran', 'Zainab', 'Ayesha',
  // South leaning
  'Karthik', 'Arun', 'Senthil', 'Prabhu', 'Ganesh', 'Vignesh', 'Bala', 'Dinesh', 'Suresh', 'Ramesh',
  'Lakshmi', 'Revathi', 'Saranya', 'Anitha', 'Nithya', 'Sowmya', 'Keerthana', 'Pavithra', 'Gowtham', 'Praveen',
  // East leaning
  'Sourav', 'Debashish', 'Abir', 'Rohit', 'Sudip', 'Ananya2', 'Mou', 'Ritwik', 'Sagnik', 'Trisha',
] as const

export const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Mehta', 'Shah', 'Patel', 'Kapoor', 'Malhotra', 'Chopra', 'Bhatt',
  'Trivedi', 'Agarwal', 'Bansal', 'Jain', 'Chauhan', 'Singh', 'Kumar', 'Yadav', 'Mishra', 'Tiwari',
  'Pandey', 'Joshi', 'Desai', 'Rathi', 'Bora', 'Iyer', 'Nair', 'Menon', 'Pillai', 'Krishnan',
  'Subramaniam', 'Raghavan', 'Rajan', 'Venkatesan', 'Murthy', 'Reddy', 'Rao', 'Naidu', 'Kulkarni', 'Deshpande',
  'Chatterjee', 'Banerjee', 'Mukherjee', 'Das', 'Bose', 'Roy', 'Saikia', 'Hazarika', 'Gogoi', 'Baruah',
] as const

// [city, isMetro]
export const CITIES: readonly [string, boolean][] = [
  ['Mumbai', true], ['Delhi', true], ['Bengaluru', true], ['Chennai', true],
  ['Kolkata', true], ['Hyderabad', true], ['Pune', true], ['Ahmedabad', true],
  ['Jaipur', false], ['Lucknow', false], ['Chandigarh', false], ['Kochi', false],
  ['Coimbatore', false], ['Nagpur', false], ['Indore', false], ['Bhopal', false],
  ['Surat', false], ['Vadodara', false], ['Visakhapatnam', false], ['Guwahati', false],
  ['Patna', false], ['Ranchi', false], ['Bhubaneswar', false], ['Mysuru', false],
  ['Thiruvananthapuram', false], ['Madurai', false], ['Nashik', false], ['Rajkot', false],
]

export const CITY_NAMES = CITIES.map((c) => c[0])
export const CITY_WEIGHTS = CITIES.map((c) => (c[1] ? 3.2 : 1))

// --- Message copy ----------------------------------------------------------
// Real composed bodies, not placeholders. `{name}`, `{amount}`, `{link}` are
// substituted by the generator. Kept under ~320 chars per the compose.py
// contract in 8.6 (policy_self_check.under_320_chars).

export const MESSAGE_TEMPLATES = {
  en: {
    nudge_free_reminder: [
      "Hi {name}, your order for {amount} is still waiting — your card details are saved, so you can finish in one tap: {link}",
      "{name}, looks like your payment didn't go through. No charge was made. Pick up where you left off here: {link}",
    ],
    nudge_free_update_card: [
      "Hi {name}, the card on file for your {amount} order has expired. Update it here and we'll retry automatically: {link}",
      "{name}, your saved card was declined (expired). Add a new one in 30 seconds and your order will go through: {link}",
    ],
    nudge_incentive: [
      "Hi {name}, we noticed your {amount} order didn't complete. Here's ₹{incentive} off if you finish in the next 2 hours: {link}",
    ],
  },
  hinglish: {
    nudge_free_reminder: [
      "Hi {name}, aapka {amount} ka order abhi bhi pending hai. Card details saved hain, ek tap mein complete karein: {link}",
      "{name}, payment complete nahi hua lekin koi paisa deduct nahi hua. Yahan se continue karein: {link}",
    ],
    nudge_free_update_card: [
      "Hi {name}, aapka saved card expire ho gaya hai {amount} ke order ke liye. Naya card add karein, hum automatically retry kar denge: {link}",
    ],
    nudge_incentive: [
      "Hi {name}, aapka {amount} ka order abhi tak complete nahi hua. Agle 2 ghante mein order karein aur ₹{incentive} off paayein: {link}",
    ],
  },
  ta: {
    nudge_free_reminder: [
      "Hi {name}, ungal {amount} order innum pending-la irukku. Card details save panni irukkom, one tap-la complete pannunga: {link}",
    ],
    nudge_free_update_card: [
      "{name}, ungal saved card expire aiduchu {amount} order-ku. Puthu card add pannunga, naanga automatic-a retry pannuvom: {link}",
    ],
    nudge_incentive: [
      "Hi {name}, ungal {amount} order innum complete aagala. Adutha 2 mani neram-la order pannina ₹{incentive} discount kidaikum: {link}",
    ],
  },
} as const

export const HEADLINE_TEMPLATES = {
  self_recovered_hold: [
    'Returned on their own in {duration}. We spent nothing.',
    'Came back unprompted after {duration}. No message sent.',
  ],
  self_recovered_generic: ['Self-recovered after {duration}, before any action was needed.'],
  agent_recovered_nudge: ['Recovered {amount} after a free reminder.', 'Completed payment {duration} after a nudge.'],
  agent_recovered_incentive: ['Recovered {amount} after a ₹{incentive} incentive.'],
  agent_recovered_retry: ['Recovered {amount} on a scheduled retry.', 'Retry succeeded — payment went through.'],
  agent_recovered_escalate: ['Recovered after human follow-up.'],
  lost: ['No response after {contacts} contacts. Marked lost.', 'Customer did not return. Marked lost.'],
  expired: ['Event aged out after 14 sim-days with no resolution.'],
} as const

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`)
}
