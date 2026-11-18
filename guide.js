/* Saado POS — guide text shown inside the app (More → Guide). Staff guide (one page) and owner guide, Somali and English. */
window.GUIDE = {
  so: {
    staff: `
<h4>1. Gal</h4><ol><li>Fur app-ka Saado POS.</li><li>Ka dooro magacaaga liiska, geli PIN-kaaga, taabo <b>Gal</b>.</li><li>Haddii aad PIN khaldan 5 jeer geliso, sug 5 daqiiqo.</li></ol>
<h4>2. Bilow wareegga</h4><ol><li>Taabo <b>Wareeg</b> (hoose).</li><li>Tiri lacagta khasnadda, eeg haraaga Zaad iyo Edahab, geli.</li><li>Taabo <b>Bilow wareegga</b>. Hadda waad iibin kartaa.</li></ol>
<h4>3. Iibi</h4><ol><li>Taabo alaabta (badhamada waaweyn), ama sawir baarkoodka, ama qor magaca.</li>
<li>Alaab badan: fur kamaradda oo sii wad sawirka — cod kasta hal shay ayuu ku darayaa.</li>
<li>Taabo <b>Bixi</b>. Dooro <b>Caddaan / Zaad / Edahab / Deyn</b>.</li>
<li>Caddaan: geli lacagta uu bixiyey (SH ama USD) — baaqiga waxaa lagu tusayaa SH.</li>
<li>Zaad / Edahab: macmiilka tus lambarka akoonka. Hubi in lacagtu timid.</li>
<li>Zaad / Edahab: dooro <b>SH</b> ama <b>USD</b> — sida macmiilku u bixiyey.</li>
<li>Taabo <b>Dhammee iibka</b>.</li>
<li>Macmiil kale ayaa yimid? Taabo <b>Dhig</b> (dambiisha hoose). Dabadeed ka soo celi badhanka sare.</li>
<li>Dambiisha oo dhan ka saar: taabo <b>✕</b>. Khalad? Taabo <b>Celi</b> 5 ilbiriqsi gudahood.</li></ol>
<h4>Iib khaldan ma dhacay?</h4><p><b>Wareeg → Iibka wareeggayga</b> → taabo iibka → <b>Celi iibka</b>, dooro sababta. Kaydka, lacagta la filayo iyo deynta macmiilka si toos ah ayaa loo saxayaa. Wareeggaaga furan oo keliya; milkiiluhu wuu arkaa.</p>
<h4>Lacag ka qaad khasnadda</h4><p><b>Wareeg → Lacag ka qaad khasnadda</b>: lacagta, SH ama USD, yaa qaatay, sababta. Caddaanka la filayo wuu yaraanayaa.</p>
<h4>4. Internet la'aan</h4><p>Iibku wuu shaqaynayaa xitaa internet la'aan. Calaamadda sare waxay muujinaysaa inta sugaysa. Marka internet-ku yimaado si toos ah ayaa loo dirayaa. <b>Ha ka bixin</b> ka hor inta aan la dirin.</p>
<h4>5. Deyn iyo lacag-bixin</h4><ul><li>Iib deyn ah: dooro <b>Deyn</b>, dooro macmiilka (ama + macmiil cusub).</li><li>Macmiil deyn bixinaya: <b>Macaamiil</b> → magaca → <b>Qaado lacag</b>.</li></ul>
<h4>6. Kharash iyo celin</h4><ul><li>Kharash: <b>Wax kale → Kharashaad</b>. Ka dooro <b>nooca</b> liiska, dooro <b>SH</b> ama <b>USD</b>, qor lacagta, sida loo bixiyey, <b>maxaa lagu bixiyey</b> iyo qoraal haddii loo baahdo. "Kale" waa in la qoraa sababta.</li><li>Kharash khaldan: taabo <b>Celi</b> oo dooro sababta — <b>isla maalintaas oo keliya</b>. Berri lama celin karo.</li><li>Alaab la soo celiyey: <b>Wax kale → Celin lacag → Codso</b>, qor sababta. Milkiilaha ayaa ansixinaya.</li></ul>
<h4>7. Fast Food — dhammaadka maalinta</h4><p><b>Wax kale → Agabka cuntada → Isticmaalka maanta</b>: geli inta bur, saliid, baradho iyo digaag la isticmaalay.</p>
<h4>8. Xir wareegga</h4><ol><li>Taabo <b>Wareeg</b>. Eeg "Hadda khasnadda la filayo".</li><li>Tiri lacagta. Qor <b>SHILIN</b> iyo <b>DOOLAR</b> kasta oo akoon ah (Caddaan, Zaad, Edahab). Wadarta app-ka ayaa isku daraya.</li><li>✓ cagaar = sax. Taabo <b>Xir wareegga</b>. Waxaad arkaysaa haddii ay sax tahay, dheeraad ama dhiman.</li></ol>
<div class="note">Beddel PIN-kaaga: <b>Wax kale → PIN-kayga</b>. PIN-kaaga cidna ha u sheegin.</div>`,
    owner: `
<h4>Shaqada maalinlaha</h4><ul>
<li><b>Hoyga</b>: iibka maanta (Dukaan, Fast Food, ama labadaba), faa'iidada, caddaan/Zaad/Edahab/deyn, iyo waxyaabaha u baahan fiiro (kayd yar, dhacaya, agab yar, codsiyo celin, dalabyo sugaya).</li>
<li>Badhanka sare <b>Dukaan / Cunto</b> ayaa beddelaya ganacsiga aad ka shaqaynayso.</li>
<li>Soo koobidda maalinta waxay kuu imaanaysaa <b>iimayl</b> (eeg "Warbixinnada iimaylka").</li></ul>
<h4>Alaabta</h4><ul>
<li><b>Wax kale → Alaabta → + Alaab cusub</b>. Baarkoodka ku sawir kamaradda. Calaamadda xiddigta = had iyo jeer ka muuji shaashadda iibka.</li>
<li>Alaab badan: <b>Soo geli CSV / Excel</b>. Marka hore <b>Soo deji tusaalaha</b>, ku buuxi Excel, kadib soo geli. Baarkood isku mid ah = waa la cusboonaysiinayaa.</li>
<li><b>Tirinta kaydka</b>: sawir shay kasta, qor tirada dhabta ah, kaydi.</li></ul>
<h4>Iibsiga (Dalabka iibsiga iyo alaab-keenayaasha)</h4><ol>
<li><b>Wax kale → Iibsiga → + Dalab cusub</b>. Dooro alaab-keenaha, ku dar alaabta (ama "Ku dar alaabta yaraatay"), tirada iyo qiimaha.</li>
<li>Lacag-bixinta: <b>Deyn – bixi dambe</b>, <b>Qayb hadda bixi</b>, ama <b>Dhammaan hadda bixi</b>.</li>
<li><b>Kaydi oo dir</b>: PDF-ka dalabka waxaa loo diraa alaab-keenaha WhatsApp. (Qiimaha PDF-ka waad daari kartaa ama dami kartaa.)</li>
<li>Marka alaabtu timaado: fur dalabka → <b>Alaabtii way timid</b>. Hubi tirada iyo qiimaha → <b>Ku dar kaydka</b>. Kaydku markaas ayuu kordhayaa.</li>
<li>Lacagta dambe: fur dalabka → <b>Bixi</b>. Lacag kasta oo la bixiyo waxay si toos ah u galaysaa Kharashaadka.</li>
<li>Tabka <b>Alaab-keenayaal</b>: inta aan ku leenahay qof kasta, taariikhda lacag-bixinta iyo alaabta la helay.</li></ol>
<h4>Isticmaalayaasha (Wax kale → Isticmaalayaasha)</h4><ul>
<li>Ku dar shaqaale: magac, meesha uu ka shaqeeyo, luqadda, oggolaanshaha. PIN ayaa la sameynayaa — hal mar ayaa la muujinayaa.</li>
<li><b>Samee PIN cusub</b> haddii qof illoobo. Dami "Akoonku waa shaqaynayaa" si aad u xirto.</li>
<li>"Saacadaha ka baxsan": shaqaale caadi ah ma geli karo saacadaha shaqada ka baxsan (Dukaan 8–1 iyo 4–11, Fast Food 5–12) haddii aanad oggolaan.</li></ul>
<h4>Dejinta</h4><p>Sicirka USD, soo dhoweynta (500), akoonnada Zaad/Edahab, deyn daar/dami, noocyada dalabka Fast Food, saacadaha, waqtiga xiritaanka Fast Food, noocyada kharashka, Fast Food daar/dami, waqtiyada iimaylka, xadka daahidda. Cidda arkaysa tabka <b>Kharashka</b>: Isticmaalayaasha → fur qofka → calaamadi ama ka saar "Tabka kharashka". Halkan waxaa sidoo kale ku yaal badhanka <b>Ku rakib app-ka</b>.</p>
<h4>Wareegyada iyo shaqaalaha</h4><ul><li><b>Hoyga → Wareegyada maanta</b>: goorta qof kasta bilaabay. "Daahay" = in ka badan 10 daqiiqo kadib jadwalka (Dejinta → Daahid kadib).</li><li>Iibka la celiyey iyo lacagta khasnadda laga qaatay waxay ka muuqdaan Hoyga iyo Warbixinnada.</li><li>Tirtir: alaabta, macaamiisha, alaab-keenayaasha (furo → <b>Tirtir</b>). Wax taariikh leh waa la qarinayaa, lama tirtirayo. Qof deyn leh lama tirtiri karo.</li></ul>
<h4>Falanqayn</h4><p><b>Warbixinnada → Falanqayn</b>: bishan iyo bishii hore, maalmaha ugu fiican, saacadaha mashquulka, imaanshaha shaqaalaha iyo talo ku saabsan waqtiga xiritaanka Fast Food.</p>
<h4>Warbixinnada iimaylka</h4><ul><li><b>Dejinta → Warbixinnada iimaylka → Ku dar qof</b>. Qof kasta wuxuu doortaa maalinle, toddobaadle, bille iyo/ama kayd yar.</li><li><b>Dejinta → Goorta iimaylada la dirayo</b>: saacadda maalinlaha, maalinta iyo saacadda toddobaadlaha, bille (maalinta ugu dambeysa ama 1-da bisha xigta) iyo kayd yar (isla markiiba, maalintii hal liis, ama dami). Saacad ka horreysa 12:00 = warbixinta shalay.</li><li>Taabo <b>Dir tijaabo</b> si aad u hubiso.</li><li>Shaqaalaha: <b>Wax kale → Warbixinnadayda iimaylka</b> si ay u beddelaan inta jeer.</li></ul>
<h4>Fast Food daar / dami</h4><p><b>Dejinta → Ganacsiyada</b>. Marka la damiyo: liiska cuntada, warbixinnada iyo shaqaalaha Fast Food waa la qarinayaa, Sacad ma geli karo. Waxba lama tirtirayo.</p>
<h4>Keydka (Archive) iyo Reset</h4><ul><li><b>Dejinta → U guuri xogta hore keydka</b>: xogta ka da'weyn 3 bilood waxay u guurtaa Sheet cusub oo Google Drive ku jira (galka <b>Saado POS Archive</b>), PDF soo koobid ah iyo haraaga. Haraaga deynta waa la sii wadayaa. Samee marka xariiqda cabbirka Sheet-ku casaato.</li><li><b>Qaybta khatarta → Tirtir xogta</b>: calaamadi waxa la tirtirayo, qor RESET iyo PIN-kaaga. Marka hore nuqul ayaa la kaydiyaa. Galka keydka weligiis lama tirtiro.</li></ul>
<h4>Warbixinnada</h4><p>Iibka maalinlaha, faa'iidada, alaabta ugu iibka badan, iibka shaqaale kasta, kharashaadka, deynta macaamiisha, kayd yar, haraaga lacagta wareegyada. <b>Faa'iido = iib saafi ah − qiimaha iibsiga alaabta − kharashaadka.</b></p>
<h4>Kaydinta (backup)</h4><p>Habeen kasta 3:00 nuqul ayaa la galiyaa Google Drive galka <b>Saado POS Backups</b>. Dejinta → <b>Hadda kaydi nuqul</b>.</p>
<div class="note">Ereyada Soomaaliga ah: fur faylka <b>i18n.js</b> ee GitHub, beddel qoraalka midig, kaydi. Kadibna kor u qaad lambarka nooca ee <b>sw.js</b>.</div>`
  },
  en: {
    staff: `
<h4>1. Log in</h4><ol><li>Open the Saado POS app.</li><li>Pick your name from the list, type your PIN, tap <b>Enter</b>.</li><li>5 wrong PINs lock the account for 5 minutes.</li></ol>
<h4>2. Start your shift</h4><ol><li>Tap <b>Shift</b> (bottom bar).</li><li>Count the cash drawer, check the Zaad and Edahab balances, type them in.</li><li>Tap <b>Start shift</b>. Now you can sell.</li></ol>
<h4>3. Sell</h4><ol><li>Tap items (big buttons), or scan the barcode, or type the name.</li>
<li>Many items: open the camera and keep scanning — each beep adds one item.</li>
<li>Tap <b>Pay</b>. Choose <b>Cash / Zaad / Edahab / Credit</b>.</li>
<li>Cash: type what the customer gave (SH or USD) — change is shown in SH.</li>
<li>Zaad / Edahab: show the customer the account number. Check the money arrived.</li>
<li>Zaad / Edahab: choose <b>SH</b> or <b>USD</b> — how the customer paid.</li>
<li>Tap <b>Complete sale</b>.</li>
<li>Another customer is waiting? Tap <b>Park</b> (on the cart bar). Bring it back later from the button at the top.</li>
<li>Empty the cart: tap <b>✕</b>. Mistake? Tap <b>Undo</b> within 5 seconds.</li></ol>
<h4>Made a wrong sale?</h4><p><b>Shift → Sales in my shift</b> → tap the sale → <b>Undo sale</b>, pick a reason. Stock, expected money and the customer's debt are fixed automatically. Only in your own open shift; the owner sees every undo.</p>
<h4>Take cash out</h4><p><b>Shift → Take cash out</b>: amount, SH or USD, who took it, why. Expected cash goes down.</p>
<h4>4. No internet</h4><p>Selling still works. The icon at the top shows how many are waiting. They are sent automatically when the internet returns. <b>Do not log out</b> before they are sent.</p>
<h4>5. Credit and payments</h4><ul><li>Credit sale: choose <b>Credit</b>, pick the customer (or + new customer).</li><li>Customer pays debt: <b>Customers</b> → name → <b>Receive payment</b>.</li></ul>
<h4>6. Expenses and refunds</h4><ul><li>Expense: <b>More → Expenses</b>. Pick the <b>category</b> from the list, choose <b>SH</b> or <b>USD</b>, type the amount, how it was paid, <b>what it was for</b> and a note if needed. "Other" needs an explanation.</li><li>Wrong expense: tap <b>Undo</b> and pick a reason — <b>only on the same day</b>. From the next day it can't be undone.</li><li>Returned item: <b>More → Refunds → Request</b>, write the reason. An owner approves it.</li></ul>
<h4>7. Fast Food — end of day</h4><p><b>More → Ingredients → End of day usage</b>: type how much flour, oil, potatoes and chicken were used.</p>
<h4>8. End your shift</h4><ol><li>Tap <b>Shift</b>. Look at "Expected in the drawer now".</li><li>Count the money. Type the <b>SHILLING</b> and <b>DOLLARS</b> for each account (Cash, Zaad, Edahab). The app adds up the totals.</li><li>Green ✓ = correct. Tap <b>End shift</b>. You see if it is correct, extra or short.</li></ol>
<div class="note">Change your PIN: <b>More → My PIN</b>. Never tell anyone your PIN.</div>`,
    owner: `
<h4>Daily use</h4><ul>
<li><b>Home</b>: today's sales (Shop, Fast Food or both), profit, cash/Zaad/Edahab/credit, and what needs attention (low stock, expiring, low ingredients, refund requests, orders waiting for delivery).</li>
<li>The <b>Shop / Food</b> switch at the top changes which business you work in.</li>
<li>The daily summary comes by <b>email</b> (see "Email reports").</li></ul>
<h4>Products</h4><ul>
<li><b>More → Products → + New product</b>. Scan the barcode with the camera. The star = always show on the sell screen.</li>
<li>Many products: <b>Import CSV / Excel</b>. First <b>Download template</b>, fill it in Excel, then import. Same barcode = updated, not duplicated.</li>
<li><b>Stock count</b>: scan each item, type the real count, save.</li></ul>
<h4>Purchasing (purchase orders and suppliers)</h4><ol>
<li><b>More → Purchasing → + New order</b>. Pick the supplier, add items (or "Add low-stock items"), quantity and unit cost.</li>
<li>Payment: <b>Credit – pay later</b>, <b>Pay part now</b> or <b>Pay all now</b>.</li>
<li><b>Save &amp; send</b>: the order PDF goes to the supplier on WhatsApp. (You can show or hide prices on the PDF.)</li>
<li>When the goods arrive: open the order → <b>Goods received</b>. Check quantities and prices → <b>Add to stock</b>. Only then does stock go up.</li>
<li>Paying later: open the order → <b>Pay</b>. Every payment is also saved as an expense.</li>
<li>The <b>Suppliers</b> tab shows what we owe each supplier, payments and deliveries.</li></ol>
<h4>Users (More → Users)</h4><ul>
<li>Add staff: name, where they work, language, permissions. A PIN is created and shown once.</li>
<li><b>Make a new PIN</b> if someone forgets. Switch off "Account active" to disable.</li>
<li>"Outside shift hours": employees cannot use the app outside working hours (Shop 8–1 and 4–11, Fast Food 5–12) unless you allow it.</li></ul>
<h4>Settings</h4><p>USD rate, rounding (500), Zaad/Edahab accounts, credit on/off, Fast Food order types, hours, Fast Food closing time, expense categories, Fast Food on/off, email times, the late limit. Who sees the <b>Expenses</b> tab: Users → open the person → tick or untick "Expenses tab". The <b>Install the app</b> button is here too.</p>
<h4>Shifts and staff</h4><ul><li><b>Home → Shifts today</b>: when each person started. "Late" = more than 10 minutes after the schedule (Settings → Late after).</li><li>Undone sales and cash taken out show on Home and in Reports.</li><li>Delete products, customers and suppliers (open → <b>Delete</b>). Anything with history is hidden, not erased. Someone with a balance can't be deleted.</li></ul>
<h4>Insights</h4><p><b>Reports → Insights</b>: this month vs last month, best days, busiest hours, staff attendance and a tip about the Fast Food closing time.</p>
<h4>Email reports</h4><ul><li><b>Settings → Email reports → Add person</b>. Each person picks daily, weekly, monthly and/or low stock.</li><li><b>Settings → When emails are sent</b>: the daily time, the weekly day and time, monthly (last day of the month or the 1st of the next month) and low stock (at once, one list a day, or off). A time before 12:00 = the report for yesterday.</li><li>Tap <b>Send test</b> to check.</li><li>Staff: <b>More → My email reports</b> to change how often.</li></ul>
<h4>Fast Food on / off</h4><p><b>Settings → Businesses</b>. When off: the Fast Food menu, reports and staff are hidden and Sacad can't log in. Nothing is deleted.</p>
<h4>Archive and Reset</h4><ul><li><b>Settings → Archive old data</b>: data older than 3 months moves to a new Sheet in Google Drive (folder <b>Saado POS Archive</b>) with a PDF summary and balances. Debts are carried forward. Do it when the Sheet size bar turns red.</li><li><b>Danger zone → Reset data</b>: tick what to delete, type RESET and your PIN. A safety copy is saved first. The Archive folder is never reset.</li></ul>
<h4>Reports</h4><p>Daily sales, profit, best sellers, sales per employee, expenses, customer debts, low stock, money balances from shifts. <b>Profit = net sales − cost of goods sold − expenses.</b></p>
<h4>Backups</h4><p>Every night at 3:00 a copy goes to the Google Drive folder <b>Saado POS Backups</b>. Settings → <b>Back up now</b>.</p>
<div class="note">Somali words: open <b>i18n.js</b> on GitHub, change the text on the right, save, then raise the version number in <b>sw.js</b>.</div>`
  }
};
