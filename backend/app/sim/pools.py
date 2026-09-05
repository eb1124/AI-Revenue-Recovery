"""
Name / city pools for population generation — ported from
frontend/scripts/fixtures/pools.ts so the same realism bar applies on both
sides ("Indian names and cities with a natural distribution, not all
Mumbai" — 5.4 customers.city: "Weighted to metro/tier-2").
"""

FIRST_NAMES = [
    # North / West leaning
    "Aarav", "Vihaan", "Aditya", "Vivaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan",
    "Rohan", "Kabir", "Aryan", "Dhruv", "Karan", "Nikhil", "Rahul", "Amit", "Rajesh", "Vikram",
    "Manoj", "Deepak", "Sanjay", "Anand", "Gaurav", "Varun", "Siddharth", "Abhishek", "Naveen", "Ashok",
    "Ananya", "Diya", "Ira", "Myra", "Sara", "Aadhya", "Kiara", "Pari", "Anika", "Navya",
    "Meera", "Priya", "Kavya", "Neha", "Pooja", "Sneha", "Divya", "Shreya", "Nisha", "Ritu",
    "Anjali", "Sunita", "Rekha", "Radha", "Kavita", "Swati", "Preeti", "Aditi", "Ishita", "Riya",
    "Jhanvi", "Aarushi", "Deepika", "Manisha", "Rashmi", "Sana", "Farhan", "Imran", "Zainab", "Ayesha",
    # South leaning
    "Karthik", "Arun", "Senthil", "Prabhu", "Ganesh", "Vignesh", "Bala", "Dinesh", "Suresh", "Ramesh",
    "Lakshmi", "Revathi", "Saranya", "Anitha", "Nithya", "Sowmya", "Keerthana", "Pavithra", "Gowtham", "Praveen",
    # East leaning
    "Sourav", "Debashish", "Abir", "Rohit", "Sudip", "Mou", "Ritwik", "Sagnik", "Trisha",
]

LAST_NAMES = [
    "Sharma", "Verma", "Gupta", "Mehta", "Shah", "Patel", "Kapoor", "Malhotra", "Chopra", "Bhatt",
    "Trivedi", "Agarwal", "Bansal", "Jain", "Chauhan", "Singh", "Kumar", "Yadav", "Mishra", "Tiwari",
    "Pandey", "Joshi", "Desai", "Rathi", "Bora", "Iyer", "Nair", "Menon", "Pillai", "Krishnan",
    "Subramaniam", "Raghavan", "Rajan", "Venkatesan", "Murthy", "Reddy", "Rao", "Naidu", "Kulkarni", "Deshpande",
    "Chatterjee", "Banerjee", "Mukherjee", "Das", "Bose", "Roy", "Saikia", "Hazarika", "Gogoi", "Baruah",
]

# (city, is_metro, is_tamil_speaking)
CITIES = [
    ("Mumbai", True, False), ("Delhi", True, False), ("Bengaluru", True, False), ("Chennai", True, True),
    ("Kolkata", True, False), ("Hyderabad", True, False), ("Pune", True, False), ("Ahmedabad", True, False),
    ("Jaipur", False, False), ("Lucknow", False, False), ("Chandigarh", False, False), ("Kochi", False, False),
    ("Coimbatore", False, True), ("Nagpur", False, False), ("Indore", False, False), ("Bhopal", False, False),
    ("Surat", False, False), ("Vadodara", False, False), ("Visakhapatnam", False, False), ("Guwahati", False, False),
    ("Patna", False, False), ("Ranchi", False, False), ("Bhubaneswar", False, False), ("Mysuru", False, False),
    ("Thiruvananthapuram", False, True), ("Madurai", False, True), ("Nashik", False, False), ("Rajkot", False, False),
]
CITY_NAMES = [c[0] for c in CITIES]
CITY_WEIGHTS = [3.2 if c[1] else 1.0 for c in CITIES]
CITY_IS_TAMIL = {c[0]: c[2] for c in CITIES}
