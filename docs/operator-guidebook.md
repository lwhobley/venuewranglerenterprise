# Venue Wrangler Enterprise: The Operator's Field Guide
**The Plain-English, Step-by-Step Manual for Venue GMs, F&B Directors, Supervisors, and Staff**

---

## Welcome to Venue Wrangler

Venue Wrangler is an all-in-one operations platform built specifically for fast-paced hospitality venues, banquet halls, multi-outlet resorts, and stadiums. It connects your **staff time clock**, **shift scheduling**, **floor plans**, **event orders (BEOs)**, **bar & kitchen inventory**, and **live event operations** into a single mobile and web app.

This guide is written in plain English without technical jargon so you and your team can get up and running on Day 1.

---

## Table of Contents

1. [User Roles: Who Sees What](#1-user-roles-who-sees-what)
2. [Getting Started & First Login](#2-getting-started--first-login)
3. [The Time Clock & GPS Geofencing (Punching In/Out)](#3-the-time-clock--gps-geofencing)
4. [Staff Scheduling, Shift Swaps & Availability](#4-staff-scheduling-shift-swaps--availability)
5. [Interactive Floor Plans & Table Management](#5-interactive-floor-plans--table-management)
6. [Reservations & Guest Waitlists](#6-reservations--guest-waitlists)
7. [Sales, Contracts & Banquet Event Orders (BEOs)](#7-sales-contracts--banquet-event-orders-beos)
8. [Bar & Kitchen Inventory (Counts, Transfers & Barcode Scanning)](#8-bar--kitchen-inventory)
9. [Live Event Command Center & Issue Tracking](#9-live-event-command-center--issue-tracking)
10. [Staff Rosters & Role Management](#10-staff-rosters--role-management)
11. [Team Chat, SOPs & Document Library](#11-team-chat-sops--document-library)
12. [Post-Event Closeout, Reports & Payroll Export](#12-post-event-closeout-reports--payroll-export)
13. [Troubleshooting & Offline Mode (What if Wi-Fi Drops?)](#13-troubleshooting--offline-mode)

---

## 1. User Roles: Who Sees What

Every person in Venue Wrangler has a specific role. You never have to worry about a bartender accidentally editing payroll or a server seeing financial reports:

| Role | What They Can Do | Typical Team Member |
| :--- | :--- | :--- |
| **Owner / Organization Admin** | Full access to all venues, financial exports, billing, and system settings. | Venue Owner, Operating Partner, VP of Operations |
| **Admin / GM** | Full control over a specific venue: hiring, scheduling, BEOs, floor plans, and closeout. | General Manager, Director of Operations |
| **F&B Director / Executive Chef** | Manage menus, recipes, inventory transfers, BEO execution, and kitchen prep tickets. | Food & Beverage Director, Head Chef |
| **Manager / Supervisor** | View live clock board, approve shift swaps, report issues, manage floor seating. | Floor Manager, Concourse Supervisor, Banquet Captain |
| **Suite Manager** | View VIP suite BEOs, request beverage replenishment, manage suite servers. | Premium Services Manager, Suite Lead |
| **Staff / Server / Bartender** | Punch in/out within GPS fence, view their personal schedule, request time off, view floor layout. | Bartenders, Servers, Line Cooks, Concession Cashiers |

---

## 2. Getting Started & First Login

### For Staff
1. Download **Venue Wrangler** from TestFlight (iOS) or the Google Play Store (Android).
2. Open the app and enter your email address and password provided by your manager (or sign in with your company's SSO button like Okta/Google if enabled).
3. **Allow Location Permissions**: Tap **"Allow While Using App"**. The app requires this to verify you are on-site when punching the time clock.
4. Select your assigned venue from the home screen.

### For Managers & Admins
* If you are setting up a brand-new venue, log into the **Manager Portal**.
* Head to **Settings → Venue Profile** to verify your venue name, time zone, and address coordinates.
* Ensure your GPS geofence boundary is set (the default is 150 meters from the venue center).

---

## 3. The Time Clock & GPS Geofencing

Venue Wrangler stops "buddy punching" (clocking in for a friend) and "parking lot punching" by checking the phone's physical GPS location before allowing a punch.

```
[Staff Phone] ---> Checks GPS Location ---> Inside 150m?
                                              ├── YES: Punch Approved & Time Recorded
                                              └── NO:  "Outside Venue Perimeter" Alert
```

### How Staff Punch In and Out:
1. Tap the **Clock** tab at the bottom of the screen.
2. Tap the large green button: **"Clock In"**.
3. The app will confirm your GPS location. In less than two seconds, your timer begins running.
4. **Taking a Break:** Tap **"Start Break"** (paid or unpaid depending on venue policy). Tap **"End Break"** when you return.
5. **Clocking Out:** Tap the red button: **"Clock Out"**. Your total hours for the shift are instantly logged.

### How Managers Monitor the Floor (The Live Clock Board):
1. Navigate to the **Clock** tab. Because you have a Manager role, you will see the **Live Attendance Board**.
2. See at a glance:
   * **Active Staff:** Who is currently clocked in right now and how many hours they have worked.
   * **Scheduled but Late:** Staff members scheduled to start who have not yet punched in.
   * **Break Status:** Who is currently on break.
3. **Manual Punch Adjustment:** If an employee forgot their phone or had battery trouble, tap the employee's name, tap **"Manual Punch Override"**, enter the time, and type the reason (e.g., *"Phone died at start of shift"*). All overrides are permanently recorded in the audit log for payroll integrity.

---

## 4. Staff Scheduling, Shift Swaps & Availability

Forget text message chains and messy whiteboards. Scheduling is fully digital.

### For Managers: Publishing the Schedule
1. Open the **Schedule** tab.
2. Select the week you want to schedule.
3. Tap **"+ Add Shift"**:
   * Pick the employee (or leave as **"Open Shift"** for anyone to claim).
   * Choose their role (e.g., Bartender, Host, Barback).
   * Pick start and end times.
4. When finished, tap **"Publish Schedule"**. All scheduled staff receive an immediate push notification on their phones.

### For Staff: Swapping Shifts & Requesting Time Off
1. Go to the **Schedule** tab.
2. **To Drop or Swap a Shift:** Tap on your upcoming shift → Tap **"Request Drop / Swap"** → Select the team member you want to take your shift (or post to the Open Shift Board).
3. **Manager Approval:** The swap will appear as *Pending*. Once a manager taps **Approve**, the calendar updates automatically for both people.
4. **Setting Availability:** Tap **"My Availability"** at the top right → Mark the days and time windows you can work over the next two weeks → Tap **Submit**.

---

## 5. Interactive Floor Plans & Table Management

The **Facility** tab gives you a real-time digital floor map of your dining room, patio, bar, or VIP suites.

### How the Floor Map Works:
* **Color Codes at a Glance:**
  * 🟢 **Green (Available):** Clean, empty, and ready to seat guests.
  * 🔵 **Blue (Seated):** Currently occupied by guests.
  * 🟡 **Yellow (Held / Reserved):** Held for an upcoming party or VIP.
  * 🔴 **Red (Dirty):** Party has left; needs bussing and sanitation.
  * ⚫ **Gray (Out of Service):** Broken chair, maintenance, or closed section.

### Seating a Table:
1. Tap any green table.
2. Tap **"Seat Table"** → Enter party size and server name. The table changes to Blue.
3. When the party finishes, tap **"Clear Table"**. The table turns Red (Dirty) so bussers know to reset it.
4. Once wiped down, tap **"Mark Clean"**. It returns to Green (Available).

### For Managers: Editing the Layout
* Tap the **Edit Layout (Pencil)** icon in the top right.
* Drag tables around to match your room setup.
* Tap **"+ Add Table"** to place round, square, or booth tables.
* Assign tables to sections (e.g., *Main Dining Room, Patio, West Terrace*).
* Tap **"Save & Publish"**.

---

## 6. Reservations & Guest Waitlists

Located in the **Guests** tab, this screen handles walk-ins and bookings.

### Adding a Walk-in to the Waitlist:
1. Open **Guests → Waitlist**.
2. Tap **"+ Add Guest"**.
3. Enter:
   * Guest Name & Cell Phone Number.
   * Party Size (e.g., 4 people).
   * Seating preference (Indoor, Patio, High-top).
4. Tap **"Add to Waitlist"**.
5. When a table opens, tap **"Page Guest"** to send them an SMS text message that their table is ready.
6. Once they arrive at the host stand, tap **"Seat"** and choose the table.

---

## 7. Sales, Contracts & Banquet Event Orders (BEOs)

This is the heartbeat of high-volume private dining, weddings, corporate galas, and stadium suite catering. Located in the **Sales** tab.

### The BEO Lifecycle:
$$\text{CRM Lead} \longrightarrow \text{Proposal Sent} \longrightarrow \text{Contract Signed} \longrightarrow \text{BEO Draft} \longrightarrow \text{Confirmed BEO} \longrightarrow \text{Kitchen Execution}$$

### Step-by-Step: Creating and Managing a BEO
1. Open the **Sales** tab and tap **BEOs**.
2. Tap **"+ New BEO"**:
   * **Event Details:** Name (*"Smith Wedding"* or *"Suite 204 - TechCorp"*), Date, Start/End Time, Guest Count.
   * **Location/Room:** Select the banquet room or luxury suite.
   * **Food & Beverage Menu:** Add catering packages (e.g., *Prime Rib Carving Station, 4x Deluxe Wine Package*).
   * **Dietary & Special Notes:** Enter allergies (*"Table 4 has severe peanut allergy"*).
   * **Setup Notes:** Linen colors, AV projector setup, dance floor location.
3. **Publishing / Confirming:** Tap **"Save as Draft"** while negotiating with the client. Once the contract is signed, tap **"Confirm BEO"**.
4. **Real-Time Amendments:** If the client calls at 3:00 PM and adds 20 guests, update the BEO and tap **"Publish Amendment"**. An immediate alert flashes on the kitchen and banquet manager screens. No more lost paper notes!

### 7.1 Auto-Building Banquet Floor Plans from BEOs
Every BEO can automatically generate an interactive, movable floor plan for the setup crew and banquet captain:
1. **Open the Floor Plan:** On any BEO card, tap **"Floor Plan"** (or head to **Facility → Banquet & Catering Floor Plan**).
2. **Auto-Build from BEO:** 
   * Tap the **"Auto-Build Floor Plan from BEO"** button.
   * The app reads the BEO's guest count, setup style, and notes, and instantly calculates table counts, aisle clearances, and positions.
   * Supports **Banquet Rounds (10 or 8 tops)**, **Classroom**, **Theater**, **Cocktail / Reception**, **U-Shape**, and **Boardroom** layouts.
   * Automatically places **Stages/Podiums**, **Dance Floors**, **Head Tables**, **Buffet Lines**, and **Bar Stations**.
3. **Movable Drag-and-Drop:** Tap and drag any table or station with your finger or mouse to adjust spacing for specific doorways, pillars, or custom setups.
4. **Capacity & Equipment Checklist:** The real-time meter tracks seats placed vs BEO target, providing a complete breakdown of required 72" rounds, banquet chairs, and 8ft buffet tables.
5. **Assigned Event Staff Roster (Working Titles for Today):**
   * Automatically suggests industry-standard staffing ratios based on guest count and amenities (e.g., 1 Banquet Captain, 1 Catering Supervisor, Banquet Attendants at 1:24 guest ratio, Lead Bartenders & Beverage Attendants per bar station, Buffet Attendants, and VIP Suite Attendants).
   * Assign team members with their specific daily working title (**Banquet Captain**, **Catering Supervisor**, **Banquet Attendant**, **Lead Bartender**, **Buffet Attendant**, **VIP Suite Attendant**, etc.), assigned station/tables, and scheduled shift hours.
   * Lineup synchronizes directly with the BEO record notes and displays on the setup diagram.
6. **Publish & Print:** Tap **"Publish to Venue"** so staff see the layout and roster on their phones, or switch to **"Setup Diagram View"** to print an all-in-one diagram and pre-shift duty roster for the banquet captain and setup crew.

---

## 8. Bar & Kitchen Inventory

Located in the **Bar Stock** tab. This replaces lost clipboards and manual spreadsheets for liquor, beer, wine, and food stock.

### Taking Inventory Counts:
1. Open **Bar Stock → Counts**.
2. Choose your outlet or storage room (e.g., *Main Bar, Concourse 102, Main Walk-in Cooler*).
3. **Method A (Fast Barcode Scan):** Tap the **Camera Icon** → Point your phone camera at the bottle barcode. The app automatically pulls up the item (e.g., *Tito's Handmade Vodka 1L*). Enter the quantity on the shelf.
4. **Method B (Manual List):** Scroll through the alphabetized product list and type the quantity.
5. Tap **"Submit Count"**.

### Moving Stock Between Bars (Transfers):
* When Bar 2 runs out of tequila and borrows 3 bottles from the Main Warehouse:
  1. Tap **"Stock Movement" → "Transfer"**.
  2. Select **Source:** *Main Warehouse*.
  3. Select **Destination:** *Bar 2*.
  4. Select items and quantities.
  5. Tap **"Confirm Transfer"**. Both inventory balances adjust instantly.

### Logging Waste & Comps:
* Dropped a bottle of wine? Kitchen overcooked a steak?
* Tap **"Log Waste / Comp"** → Pick the item → Choose the reason (*Dropped/Broken, Expired, Customer Comp*) → Tap **Save**. This prevents inventory shrinkage from showing up as unexplained theft.

---

## 9. Live Event Command Center & Issue Tracking

For game days, concerts, and major galas, the **Event Command Center** (`app/event-command-center.tsx`) gives the F&B Director and General Manager a birds-eye view of the entire facility.

```
       [Event Command Center]
                 │
   ┌─────────────┼─────────────┐
   ▼             ▼             ▼
[Outlet]      [Live]        [Issue]
Readiness    Attendance   Escalation
 (Bars/       (Punched     (Stockout,
 Kitchens)     Staff)       Broken Tap)
```

### 1. Opening the Event (Readiness Checks)
* As supervisors check their areas before doors open, they mark each outlet's readiness:
  * 🟢 **Ready** (Staffed, stocked, register open)
  * 🟡 **Delayed** (Waiting on ice or staff)
  * 🔴 **Critical** (POS down or missing key staff)
* The command center shows a progress bar of overall venue readiness.

### 2. Reporting an Urgent Issue on the Floor
If a bar runs out of draft beer cups or a credit card reader breaks:
1. Any supervisor opens **Event Issues** (`app/event-issues.tsx`).
2. Tap **"+ Report Issue"**:
   * **Outlet / Location:** *Concourse Bar 114*.
   * **Issue Type:** *Stockout / Hardware / Safety / Spillage*.
   * **Severity:** *Low / Medium / High / Critical*.
   * **Description:** *"Kegerator line 3 is pouring pure foam."*
3. Tap **Submit**.
4. The issue flashes on the Command Center board. Managers tap **"Acknowledge"** to claim it, and **"Resolve"** once fixed.

---

## 10. Staff Rosters & Role Management

Located in the **Staff** tab.

### Adding New Team Members:
1. Open **Staff → "+ Add Person"**.
2. Enter their Name, Email, and Phone Number.
3. Assign their **Role** (e.g., *Server, Bartender, Manager*).
4. Assign their **Department / Primary Outlet** (e.g., *Concessions, Banquet Service, Kitchen*).
5. Tap **"Send Invite"**. The employee receives an email to set their password and download the app.

### Bulk Import via CSV (Roster Upload):
* For venues onboarding 50+ staff at once:
  1. Open the Staff screen on the web portal.
  2. Tap **"Import Staff CSV"**.
  3. Upload your spreadsheet with columns `firstName, lastName, email, role, phone`.
  4. The system automatically creates accounts and prepares invite emails.

### Daily Working Titles for Banquets & Events:
While an employee's permanent payroll profile might list a general job title like *"Server"* or *"Supervisor"*, high-volume banquets require clear day-of command hierarchy. When building or executing an event BEO, managers assign daily operational **Working Titles**:
* **Banquet Captain:** Floor lead accountable for pacing, client contact, and service timing.
* **Catering Supervisor:** Oversees back-of-house staging, hot boxes, and food replenishment.
* **Banquet Attendant:** Stationed to specific table clusters for course clearing and water service.
* **Lead Bartender & Beverage Attendant:** Dedicated to front or satellite bar points.
* **Buffet Attendant & VIP Suite Attendant:** Dedicated to active chafing dish maintenance or private luxury suites.

---

## 11. Team Chat, SOPs & Document Library

### Team Chat (`chat.tsx`)
* **Department Channels:** Bartenders have their own group, kitchen has theirs, and managers have a private leadership channel.
* **Announcements:** Managers can post pinned broadcast messages (e.g., *"Doors open 30 minutes early tonight at 5:30 PM"*).

### Document Library (`documents.tsx`)
* Keep your venue's standard operating procedures accessible on every phone:
  * **Recipes & Plating Guides:** High-res photos of how banquet dishes and craft cocktails must look.
  * **Opening & Closing Checklists:** Step-by-step checklists for closing bartenders and line cooks.
  * **Safety & Emergency Protocols:** Fire exits, health department food holding temps, and first aid procedures.

---

## 12. Post-Event Closeout, Reports & Payroll Export

When the event ends and guests leave, the closing manager opens **Event Closeout** (`app/event-closeout.tsx`).

### The 4-Step Closeout Workflow:
1. **Attendance & Labor Review:**
   * Review all clocked-in hours for the day.
   * Auto-flag any missed clock-outs (e.g., someone forgot to punch out at 2:00 AM). The manager sets their actual departure time.
2. **Sales & Cash Reconciliation:**
   * Enter or verify register sales and tip pools.
3. **Inventory Variance:**
   * Review closing stock counts against opening counts to see beverage cost percentage and shrinkage.
4. **Final Sign-off:**
   * The General Manager or Director taps **"Approve & Lock Closeout"**.
   * Once locked, the event data is permanently preserved in the immutable audit log.

### Exporting for Payroll:
* Head to **Reports → Payroll Export**.
* Select the pay period date range (e.g., *Oct 1 to Oct 15*).
* Tap **"Download Payroll CSV"**.
* This file is pre-formatted to upload directly into **ADP, Paychex, Gusto, or QuickBooks**.

---

## 13. Troubleshooting & Offline Mode

### "What if the venue basement has zero Wi-Fi or cellular service?"
Venue Wrangler has a built-in **Offline Action Queue**:
* If an employee punches in or a supervisor reports an issue while offline, the app saves the action encrypted on their phone.
* A small badge will display: **"Pending Sync (Offline)"**.
* As soon as the device reconnects to Wi-Fi or cellular signal, all queued punches and reports upload automatically. You will never lose punch records due to dropped signal.

### "An employee says the app won't let them clock in."
1. **Check Location Settings:** Verify their phone location services are turned ON for Venue Wrangler (*Settings → Privacy → Location Services → While Using*).
2. **Check the Geofence:** Ensure they are physically on venue property. If they are sitting in their car two blocks away, the app will intentionally block the punch.
3. **Manager Override:** If their phone GPS hardware is malfunctioning, a manager can clock them in manually on the Live Clock Board.

---

### Need Further Assistance?
* **In-App Help:** Tap **Settings → Help & Support** to submit a ticket.
* **Emergency Operations Escalation:** Contact your venue organization administrator.
* **System Health:** Check the real-time server status at `/api/health`.
