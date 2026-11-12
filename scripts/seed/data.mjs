// Seed data for test profiles: 36 states and union territories, one main city each, first-name pools, and a little local flavour.
// Names are FIRST names only (the app shows nothing else). Pools are mixed per region, and every region also draws from a pan-India modern pool,
// which is how real city profiles look. City centres are approximate. Neighbourhoods are listed only where they are well known; elsewhere the city is used.

const split = (s) => s.split(/[\s,]+/).filter(Boolean);
export const NAMES = {
  pan:     { f: split('Ananya Aanya Diya Ira Isha Kavya Meera Myra Naina Navya Priya Riya Saanvi Sara Shreya Tara Zoya Aditi Anika Mira Radhika Sanya Tanvi Kiara Avni Trisha Aarohi Jiya Mehr'),
             m: split('Aarav Aryan Advait Arjun Dev Ishaan Kabir Karan Krish Neel Rohan Rahul Samar Veer Vihaan Yash Aditya Ayaan Dhruv Harsh Kunal Manav Nikhil Raghav Sahil Siddharth Tushar Varun Ankit Reyansh') },
  hindi:   { f: split('Shivani Anjali Pallavi Neha Swati Komal Ritika Garima Muskan Shruti Pragya Nidhi Aarti Sakshi Kritika Divya Aastha Khushi'),
             m: split('Amit Saurabh Ashish Vivek Gaurav Abhishek Mayank Prateek Shubham Ritesh Anurag Pankaj Vikas Sumit Deepak Anuj Piyush Utkarsh') },
  punjabi: { f: split('Simran Harleen Gurleen Manpreet Jasleen Navneet Kiran Amrit Mehak Pavneet Sukhmani Rupinder'),
             m: split('Gurpreet Harpreet Jaspreet Arshdeep Manjot Kuldeep Navdeep Ravneet Tejinder Amandeep Sukhdeep Karanveer') },
  gujarati:{ f: split('Hetal Dhwani Krupa Jinal Mansi Khushbu Purvi Riddhi Bhumi Foram Urvi Disha'),
             m: split('Jay Chirag Parth Dhaval Jignesh Hardik Ketan Nirav Mitesh Smit Meet Darshil') },
  marathi: { f: split('Rutuja Pranali Gauri Snehal Mrunal Apurva Sayali Tejaswini Shweta Manasi Ketaki Isha'),
             m: split('Omkar Sagar Swapnil Tanmay Aniket Pratik Chinmay Ameya Nilesh Hrishikesh Siddhesh Atharva') },
  goan:    { f: split('Maria Anisha Savia Nicole Reshma Priyanka Ruth Jessica Shannon Natasha Rhea Alisha'),
             m: split('Joel Cleven Aaron Savio Ronan Clinton Ashley Nelson Dylan Ryan Kevin Melvin') },
  bengali: { f: split('Sreya Tiyasha Moumita Debjani Ishita Sohini Tanushree Payel Sayantika Mitali Ankita Rimi'),
             m: split('Arnab Subhajit Soumya Abir Rajdeep Debarshi Anirban Sayan Tamal Ritwik Joy Anindya') },
  odia:    { f: split('Subhashree Smruti Lipsa Sasmita Jyotsna Sipra Dipti Swagatika Rashmita Itishree Barsha Madhusmita'),
             m: split('Satyajit Biswajit Debashish Abhisek Sambit Ashutosh Sourav Manas Pritam Subrat Sidharth Bikram') },
  assamese:{ f: split('Mrinali Dikshita Bhaswati Nilakshi Rimjhim Anushka Juri Barnali Maitrayee Deepshikha Ankita Moushumi'),
             m: split('Bhaskar Dibyajyoti Rajib Pranjal Hemanta Kaushik Jayanta Bikash Manash Rituraj Abhijit Dhruba') },
  ne:      { f: split('Esther Grace Naomi Rebecca Ruth Lydia Priscilla Hannah Sarah Mary Rosy Jenny'),
             m: split('Joshua Daniel Samuel Joel Caleb David Isaac Nathan Elijah Aaron Lalit Bobby') },
  himalaya:{ f: split('Pema Dolma Yangchen Deki Lhamo Kunzang Tashi Sonam Choden Rinzin Tsomo Diskit'),
             m: split('Tenzin Tashi Karma Dorjee Sonam Jigme Norbu Rinchen Stanzin Tsering Namgyal Lobsang') },
  telugu:  { f: split('Sravya Harika Lasya Divya Sindhu Mounika Keerthi Pravallika Sowmya Bhavana Swathi Anusha'),
             m: split('Sai Teja Karthik Pranay Venkat Charan Harsha Naveen Srikanth Vamsi Rakesh Aditya') },
  tamil:   { f: split('Dharshini Harini Janani Keerthana Meenakshi Nandhini Preethi Sowmiya Vaishnavi Yamini Abirami Kavya'),
             m: split('Arun Aravind Karthikeyan Praveen Surya Vignesh Dinesh Gokul Hariharan Santhosh Vishnu Naveen') },
  kannada: { f: split('Chaitra Deepika Spoorthi Nisarga Pooja Ramya Shwetha Pavithra Sahana Rakshita Bhavya Soumya'),
             m: split('Darshan Nikhil Pavan Prajwal Rakesh Sachin Vinay Yogesh Chetan Manoj Suhas Harish') },
  malayalam:{ f: split('Anjana Athira Devika Gayathri Lakshmi Nithya Parvathy Remya Sneha Aparna Anusree Fathima'),
             m: split('Abhijith Adarsh Akhil Anand Jithin Nikhil Sanjay Vishnu Midhun Shafeeq Joseph Febin') },
  kashmiri:{ f: split('Insha Iqra Aaliya Mehvish Sabreen Zainab Uzma Anjali Pooja Shivani Ritika Hiba'),
             m: split('Aamir Zubair Faizan Owais Sajad Burhan Umar Danish Rahul Vikas Ankush Rohit') },
};

// region: [code, name, kind, city, lat, lng, pools (name:weight...), neighbourhoods, local flavour (3 short phrases)]
const R = (code, name, kind, city, lat, lng, pools, hoods, flavour) => ({ code, name, kind, city, lat, lng, pools, hoods: split(hoods.replace(/_/g, '\u00a0')).map((h) => h.replace(/\u00a0/g, ' ')), flavour: flavour.split('|') });
export const REGIONS = [
  R('AP', 'Andhra Pradesh', 'state', 'Visakhapatnam', 17.69, 83.22, { telugu: 6, pan: 3, hindi: 1 }, 'Madhurawada MVP_Colony Gajuwaka Dwaraka_Nagar', 'RK Beach evenings|filter coffee|a bike ride to Araku'),
  R('AR', 'Arunachal Pradesh', 'state', 'Itanagar', 27.08, 93.61, { ne: 4, pan: 3, hindi: 2, assamese: 1 }, '', 'momos on a cold evening|hill drives|local music nights'),
  R('AS', 'Assam', 'state', 'Guwahati', 26.14, 91.74, { assamese: 6, pan: 3, hindi: 1 }, 'Dispur Beltola Paltan_Bazaar Zoo_Road', 'sunsets by the Brahmaputra|a long chai break|weekend trips to Shillong'),
  R('BR', 'Bihar', 'state', 'Patna', 25.61, 85.14, { hindi: 6, pan: 3 }, 'Boring_Road Kankarbagh Rajendra_Nagar Patliputra', 'litti chokha|a walk by the Ganga|late-night chai'),
  R('CG', 'Chhattisgarh', 'state', 'Raipur', 21.25, 81.63, { hindi: 6, pan: 3 }, 'Shankar_Nagar Pandri Avanti_Vihar Telibandha', 'a drive to Chitrakote|street chaat|a quiet cafe corner'),
  R('GA', 'Goa', 'state', 'Panaji', 15.50, 73.83, { goan: 5, pan: 3, marathi: 1, kannada: 1 }, 'Miramar Campal Dona_Paula Porvorim', 'beach shack evenings|fish thali|scooter rides'),
  R('GJ', 'Gujarat', 'state', 'Ahmedabad', 23.02, 72.57, { gujarati: 6, pan: 3, hindi: 1 }, 'Navrangpura Satellite Bodakdev Maninagar', 'the Sabarmati riverfront|fafda and jalebi|Law Garden snacks'),
  R('HR', 'Haryana', 'state', 'Gurugram', 28.46, 77.03, { hindi: 5, pan: 3, punjabi: 2 }, 'DLF_Phase_3 Sohna_Road Golf_Course_Road Sector_56', 'a post-work coffee|weekend drives|a quiet rooftop'),
  R('HP', 'Himachal Pradesh', 'state', 'Shimla', 31.10, 77.17, { hindi: 5, pan: 3, punjabi: 1, himalaya: 1 }, 'Sanjauli Summer_Hill Chotta_Shimla Kaithu', 'foggy mornings|The Ridge at sunset|maggi with a view'),
  R('JH', 'Jharkhand', 'state', 'Ranchi', 23.34, 85.31, { hindi: 6, pan: 3, ne: 1 }, 'Morabadi Lalpur Harmu Kanke_Road', 'waterfall day trips|a good thali|Sunday cricket'),
  R('KA', 'Karnataka', 'state', 'Bengaluru', 12.97, 77.59, { kannada: 4, pan: 4, tamil: 1, telugu: 1, malayalam: 1 }, 'Indiranagar Koramangala Whitefield Jayanagar', 'filter coffee runs|weekend rides to Nandi Hills|brewery evenings'),
  R('KL', 'Kerala', 'state', 'Kochi', 9.93, 76.27, { malayalam: 6, pan: 3, tamil: 1 }, 'Edappally Fort_Kochi Kakkanad Panampilly_Nagar', 'backwater weekends|appam and stew|sunsets at Fort Kochi'),
  R('MP', 'Madhya Pradesh', 'state', 'Bhopal', 23.26, 77.41, { hindi: 6, pan: 3 }, 'Arera_Colony MP_Nagar Kolar_Road Shahpura', 'the Upper Lake at dusk|poha and jalebi|a long drive'),
  R('MH', 'Maharashtra', 'state', 'Mumbai', 19.08, 72.88, { marathi: 3, pan: 4, gujarati: 1, hindi: 2 }, 'Bandra Andheri Powai Colaba', 'a Marine Drive walk|vada pav|a slow Sunday brunch'),
  R('MN', 'Manipur', 'state', 'Imphal', 24.82, 93.94, { ne: 4, pan: 3, hindi: 2 }, '', 'football on the weekend|a cosy cafe|a motorbike trip'),
  R('ML', 'Meghalaya', 'state', 'Shillong', 25.57, 91.88, { ne: 5, pan: 3, assamese: 1 }, '', 'live music nights|cafe hopping|a day trip to Cherrapunji'),
  R('MZ', 'Mizoram', 'state', 'Aizawl', 23.73, 92.72, { ne: 6, pan: 3 }, '', 'gospel and guitar evenings|hill views|a good bowl of noodles'),
  R('NL', 'Nagaland', 'state', 'Kohima', 25.67, 94.11, { ne: 6, pan: 3 }, '', 'rock music|a trek with friends|smoked pork and rice beer jokes'),
  R('OD', 'Odisha', 'state', 'Bhubaneswar', 20.30, 85.82, { odia: 6, pan: 3, bengali: 1 }, 'Saheed_Nagar Patia Nayapalli Jaydev_Vihar', 'a day trip to Puri|temple architecture walks|dahi bara aloo dum'),
  R('PB', 'Punjab', 'state', 'Ludhiana', 30.90, 75.86, { punjabi: 6, pan: 3, hindi: 1 }, 'Model_Town Sarabha_Nagar BRS_Nagar Pakhowal_Road', 'a lassi after a long day|a road trip|Bhangra at weddings'),
  R('RJ', 'Rajasthan', 'state', 'Jaipur', 26.91, 75.79, { hindi: 6, pan: 3 }, 'Malviya_Nagar C-Scheme Vaishali_Nagar Mansarovar', 'sunsets at Nahargarh|pyaaz kachori|a heritage walk'),
  R('SK', 'Sikkim', 'state', 'Gangtok', 27.33, 88.61, { himalaya: 3, pan: 3, hindi: 2, ne: 1 }, '', 'momos on MG Marg|monsoon walks|a cosy cafe'),
  R('TN', 'Tamil Nadu', 'state', 'Chennai', 13.08, 80.27, { tamil: 6, pan: 3, telugu: 1 }, 'Adyar T._Nagar Velachery Anna_Nagar', 'filter kaapi|evenings at Marina|a Besant Nagar beach walk'),
  R('TS', 'Telangana', 'state', 'Hyderabad', 17.39, 78.49, { telugu: 5, pan: 4, hindi: 1 }, 'Banjara_Hills Gachibowli Madhapur Kondapur', 'Irani chai|biryani debates|a Hussain Sagar evening'),
  R('TR', 'Tripura', 'state', 'Agartala', 23.83, 91.28, { bengali: 4, pan: 3, ne: 2 }, '', 'a lazy evening at a cafe|sweets and chai|a short road trip'),
  R('UP', 'Uttar Pradesh', 'state', 'Lucknow', 26.85, 80.95, { hindi: 6, pan: 3 }, 'Gomti_Nagar Hazratganj Aliganj Indira_Nagar', 'kebabs in Aminabad|the Gomti riverfront|chaat at 9pm'),
  R('UK', 'Uttarakhand', 'state', 'Dehradun', 30.32, 78.03, { hindi: 6, pan: 3, himalaya: 1 }, 'Rajpur_Road Clement_Town Race_Course Ballupur', 'a trip up to Mussoorie|cafe mornings|maggi in the rain'),
  R('WB', 'West Bengal', 'state', 'Kolkata', 22.57, 88.36, { bengali: 6, pan: 3, hindi: 1 }, 'Salt_Lake Park_Street Behala Ballygunge', 'adda over cha|kathi rolls|a Maidan evening'),
  R('AN', 'Andaman and Nicobar Islands', 'ut', 'Port Blair', 11.62, 92.73, { pan: 4, tamil: 2, bengali: 2, hindi: 2, telugu: 1 }, '', 'beach sunsets|snorkelling days|seafood on the weekend'),
  R('CH', 'Chandigarh', 'ut', 'Chandigarh', 30.73, 76.78, { punjabi: 4, hindi: 2, pan: 4 }, 'Sector_17 Sector_35 Sector_22 Sector_8', 'Sukhna Lake walks|a cafe in Sector 26|a quick drive to Kasauli'),
  R('DD', 'Dadra and Nagar Haveli and Daman and Diu', 'ut', 'Daman', 20.40, 72.83, { gujarati: 4, marathi: 2, pan: 4 }, '', 'seaside walks|a good seafood plate|an easy weekend drive'),
  R('DL', 'Delhi', 'ut', 'New Delhi', 28.61, 77.21, { hindi: 3, punjabi: 2, pan: 5 }, 'Saket Hauz_Khas Lajpat_Nagar Dwarka', 'a Lodhi Garden walk|chole bhature|a Metro-hopping Sunday'),
  R('JK', 'Jammu and Kashmir', 'ut', 'Srinagar', 34.08, 74.80, { kashmiri: 6, pan: 3 }, 'Rajbagh Lal_Chowk Hazratbal Jawahar_Nagar', 'kahwa by the Dal|a shikara ride|a quiet walk in the Mughal gardens'),
  R('LA', 'Ladakh', 'ut', 'Leh', 34.16, 77.58, { himalaya: 6, pan: 3 }, '', 'thukpa on a cold night|a drive to Nubra|stargazing'),
  R('LD', 'Lakshadweep', 'ut', 'Kavaratti', 10.57, 72.64, { malayalam: 6, pan: 3 }, '', 'lagoon swims|fresh tuna|long evening walks'),
  R('PY', 'Puducherry', 'ut', 'Puducherry', 11.93, 79.83, { tamil: 5, pan: 4, hindi: 1 }, 'White_Town Lawspet Reddiarpalayam Muthialpet', 'a seafront cycle|crepes and coffee|Auroville weekends'),
];

export const INTERESTS = ['Food', 'Coffee', 'Trekking', 'Travel', 'Music', 'Movies', 'Board games', 'Fitness', 'Cricket', 'Football', 'Photography', 'Art', 'Reading', 'Cooking', 'Dancing', 'Comedy', 'Gaming', 'Yoga', 'Road trips', 'Tech'];
export const MODE_WEIGHTS = { friendship: 0.55, serious_dating: 0.5, adventures: 0.35, hookups: 0.1, post_marital: 0.08, experimentation: 0.06 };
export const ACTIVITIES = ['chai_coffee', 'walk', 'meal', 'street_food', 'live_music', 'movie', 'museum', 'board_games', 'comedy', 'bowling', 'sports', 'market', 'trivia'];
export const PROMPTS = [
  'My ideal unexpected Sunday...', 'Something I could talk about for hours...', "One thing people wouldn't guess about me...", 'My most unusual opinion...',
  'An experience I want to try...', 'The best plan I ever made on a whim...', "I'm happiest when...",
];

// Text building blocks. {city} {local} are filled in per profile. Everything here is mild on purpose: no sexual content in any vibe.
export const TEXT = {
  intro: ['Born and raised around {city}.', 'Moved to {city} a few years ago and stayed.', 'Spend most weekdays at a screen and most weekends away from one.', 'Part-time planner, full-time overthinker.', 'A creature of routine who is trying to be more spontaneous.', 'Introvert with extrovert friends.', 'Happiest with a good playlist and no fixed plan.', 'Learning to say yes to more plans.'],
  like: ['I love {local}.', 'You will usually find me at {local}.', 'Always up for {local}.', 'A good day for me involves {local}.', 'My weak spot is {local}.'],
  quirk: ['Terrible at texting back, great in person.', 'I will always pick the restaurant with the shortest menu.', 'I take too many photos of food.', 'I own more books than I have read.', 'Strong opinions about chai.', 'I laugh at my own jokes first.', 'I plan trips I never take, then take trips I never planned.', 'Fluent in sarcasm and two other languages.', 'Cricket on in the background, always.', 'My playlist has no genre, only moods.'],
  close: ['Say hi if any of this sounds like you.', 'Message me, I do reply.', 'Open to meeting new people the slow, easy way.', 'No pressure, just good company.', 'Let us see where a good chat goes.', 'A plan beats a perfect first message.'],
  headline: {
    friendship: ['Looking for people to explore {city} with', 'New friends, old-fashioned plans', 'Weekend plans over weekday ones', 'Someone to try that new cafe with', 'Always up for {local}', 'Good conversation, better snacks'],
    serious_dating: ['Here for something real', 'Slow to text, quick to make a plan', 'Looking for my person, no rush', 'Kind, curious and a little goofy', 'Coffee first, then we will see', 'Hoping to find someone to laugh with'],
    adventures: ['Weekend trip anyone?', 'Trails, road trips and bad puns', 'Say yes first, plan later', 'Always looking for the next view', 'Pack light, travel often', 'Up before sunrise for the right plan'],
    hookups: ['Keeping it light and honest', 'Fun, easy and respectful', 'Here for a good time, no pressure', 'Clear about what I want, kind about it'],
    post_marital: ['Starting a new chapter', 'Rebuilding with good people and good coffee', 'Grown-up conversations, easy company', 'Second chapters can be the best ones'],
    experimentation: ['Curious and open-minded', 'Trying new things at my own pace', 'Exploring, with consent and kindness', 'No labels, just honest chats'],
  },
  modeBio: {
    friendship: ['Looking to meet people who like getting out of the house. Happy to do coffee, a walk or a board game night. {like}', 'New here and keen to build a small circle. {like} {quirk}'],
    serious_dating: ['I am looking for something steady and honest, with someone who values kindness and good humour. {like} {quirk}', 'Ready for a real relationship, not a pen pal. I like to take things at a comfortable pace. {like}'],
    adventures: ['Always planning the next outing, big or small. Looking for people who will actually show up. {like} {quirk}', 'Trek, ride, wander. I would rather be outside than inside. {like}'],
    hookups: ['Clear communication, good manners and mutual respect matter most to me. Keeping things casual. {quirk}'],
    post_marital: ['A little older, a little wiser, and happy to take things slowly. Easy company and honest conversation matter most. {like}'],
    experimentation: ['Open to meeting new people and seeing what feels right, always with respect and consent. {quirk}'],
  },
  answers: {
    'My ideal unexpected Sunday...': ['starts with a late breakfast and ends somewhere I did not plan to go.', 'is a long walk, then {local}.', 'is a random drive with the windows down.', 'involves a market, a stranger who gives great advice and ice cream.'],
    'Something I could talk about for hours...': ['which city has the best street food. I have data.', 'old Hindi film songs and why they are better.', 'the book I am reading and why you should too.', 'cricket, but only the dramatic bits.', 'travel plans I will probably never book.'],
    "One thing people wouldn't guess about me...": ['I can cook a very respectable biryani.', 'I am scared of pigeons.', 'I used to play an instrument seriously.', 'I have read the same novel four times.', 'I am a terrible dancer who dances anyway.'],
    'My most unusual opinion...': ['pineapple on pizza is fine. Fight me politely.', 'cold coffee is better in winter.', 'mornings are underrated and so are Mondays.', 'every group chat needs a quiet member.'],
    'An experience I want to try...': ['a long train journey with no fixed destination.', 'a solo trip somewhere with mountains.', 'learning to surf.', 'a proper pottery class.', 'a night under the stars away from city lights.'],
    'The best plan I ever made on a whim...': ['a three-hour drive for one specific plate of food.', 'a last-minute trip that turned into a week.', 'showing up at a gig where I knew nobody.', 'a sunrise trek I booked at midnight.'],
    "I'm happiest when...": ['the plan is simple and the company is good.', 'I am outside with something warm to drink.', 'my playlist is perfect and the road is empty.', 'someone else is also laughing at the dumb joke.'],
  },
};
