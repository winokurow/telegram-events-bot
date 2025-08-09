document.addEventListener('DOMContentLoaded', () => {
    if (typeof db === "undefined") {
        console.error("🔥 db is still undefined! Check firebase-init.js");
        return;
    }

    // --------------- ADD EVENT LOGIC (index.html) ---------------
    const addForm = document.getElementById('addEventForm');
    if (addForm) {
        const nameInput       = document.getElementById('eventName');
        const categoryInput   = document.getElementById('eventCategory');
        const tagsInput       = document.getElementById('eventTags');
        const descInput       = document.getElementById('eventDescription');
        const imgInput        = document.getElementById('eventImage');
        const startInput      = document.getElementById('eventStart');
        const endInput        = document.getElementById('eventEnd');
        const placeInput      = document.getElementById('eventPlace');
        const priceInput      = document.getElementById('eventPrice');
        const linkInput       = document.getElementById('eventLink');
        const contactInput    = document.getElementById('eventContact');

        addForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // 1. Collect & validate
            const name       = nameInput.value.trim();
            const category   = categoryInput.value.trim();
            const tagsRaw    = tagsInput.value.trim();    // e.g. "rock, indie, live"
            const description= descInput.value.trim();
            const startStr   = startInput.value;           // “YYYY-MM-DDTHH:MM”
            const endStr     = endInput.value;
            const place      = placeInput.value.trim();
            const price      = priceInput.value.trim();
            const link       = linkInput.value.trim();
            const contact    = contactInput.value.trim();

            if (!name || !category || !startStr || !endStr || !place) {
                alert('Please fill in all required fields (Name, Category, Start, End, Place).');
                return;
            }

            // 2. Parse tags into array
            const tagsArray = tagsRaw
                ? tagsRaw.split(',').map(t => t.trim()).filter(t => t.length > 0)
                : [];

            // 3. Create a new Firestore doc reference (to get the ID before setting data)
            const eventRef = db.collection('events').doc();
            const newEventData = {
                name,
                category,
                tags: tagsArray,
                description,
                place,
                price,
                link,
                contact,
                startDateTime: firebase.firestore.Timestamp.fromDate(new Date(startStr)),
                endDateTime: firebase.firestore.Timestamp.fromDate(new Date(endStr)),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // 4. If image file selected, upload to Storage & add imageURL to newEventData
            if (imgInput.files.length > 0) {
                const file = imgInput.files[0];
                // Unique path: eventImages/{docId}/{filename}
                const storageRef = storage.ref(`eventImages/${eventRef.id}/${file.name}`);
                try {
                    const snapshot = await storageRef.put(file);
                    const downloadURL = await snapshot.ref.getDownloadURL();
                    newEventData.imageURL = downloadURL;
                } catch (upErr) {
                    console.error('Error uploading image:', upErr);
                    alert('Failed to upload image. Please check file size/type and try again.');
                    return;
                }
            }

            // 5. Write the Firestore doc
            try {
                await eventRef.set(newEventData);
                alert('Event added successfully! It will be posted to Telegram shortly.');
                addForm.reset();
            } catch (err) {
                console.error('Error saving event:', err);
                alert('Error saving event. Please try again.');
            }
        });
    }

    // --------------- SEARCH EVENTS LOGIC (search.html) ---------------
    const searchForm = document.getElementById('searchForm');
    if (searchForm) {
        // We’ll populate category dropdown dynamically from /categories
        const categorySelect = document.getElementById('searchCategory');
        const tagsInput      = document.getElementById('searchTags');
        const dateFromInput  = document.getElementById('dateFrom');
        const dateToInput    = document.getElementById('dateTo');
        const placeInput     = document.getElementById('searchPlace');
        const keywordInput   = document.getElementById('searchKeyword');
        const resultsDiv     = document.getElementById('resultsContainer');

        // 1. Populate category dropdown
        (async () => {
            try {
                const snapshot = await db.collection('categories').orderBy('__name__').get();
                // Add an empty <option> for “any category”
                const noneOpt = document.createElement('option');
                noneOpt.value = '';
                noneOpt.textContent = '(Any Category)';
                categorySelect.appendChild(noneOpt);

                snapshot.forEach(doc => {
                    const catName = doc.id; // doc ID is category name
                    const opt = document.createElement('option');
                    opt.value = catName;
                    opt.textContent = catName;
                    categorySelect.appendChild(opt);
                });
            } catch (err) {
                console.error('Error loading categories:', err);
                // If it fails, leave only “any” option
            }
        })();

        // 2. Handle search form submission
        searchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            resultsDiv.innerHTML = '<p>Searching…</p>';

            // Read filter values
            const selectedCategory = categorySelect.value.trim(); // exact match
            const tagsRaw          = tagsInput.value.trim();      // e.g. "rock,live"
            const dateFromStr      = dateFromInput.value;         // “YYYY-MM-DD”
            const dateToStr        = dateToInput.value;
            const placeVal         = placeInput.value.trim();
            const keywordRaw       = keywordInput.value.trim().toLowerCase();

            // Build Firestore query step by step
            let query = db.collection('events');

            // (a) Category filter
            if (selectedCategory) {
                query = query.where('category', '==', selectedCategory);
            }

            // (b) Date range filter (by startDateTime)
            if (dateFromStr) {
                const fromTs = firebase.firestore.Timestamp.fromDate(new Date(dateFromStr));
                query = query.where('startDateTime', '>=', fromTs);
            }
            if (dateToStr) {
                const dt = new Date(dateToStr);
                dt.setHours(23, 59, 59, 999);
                const toTs = firebase.firestore.Timestamp.fromDate(dt);
                query = query.where('startDateTime', '<=', toTs);
            }

            // (c) Place filter (exact string match)
            if (placeVal) {
                query = query.where('place', '==', placeVal);
            }

            // (d) Tags filter: split tagsRaw by comma, use array-contains-any if at least one tag given
            let tagsArray = [];
            if (tagsRaw) {
                tagsArray = tagsRaw
                    .split(',')
                    .map(t => t.trim())
                    .filter(t => t.length > 0);
                if (tagsArray.length > 0) {
                    // Firestore supports array-contains-any for up to 10 elements
                    query = query.where('tags', 'array-contains-any', tagsArray);
                }
            }

            // Execute the query (limit to 100 for performance)
            let snapshot;
            try {
                snapshot = await query.orderBy('startDateTime', 'asc').limit(100).get();
            } catch (err) {
                console.error('Query error:', err);
                resultsDiv.innerHTML = '<p>Error running search. Check console for details.</p>';
                return;
            }

            // 3. Post-query filtering: keyword in name or description (case-insensitive)
            const matches = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (keywordRaw) {
                    const haystack = `${data.name || ''} ${data.description || ''}`.toLowerCase();
                    if (!haystack.includes(keywordRaw)) {
                        return; // skip
                    }
                }
                // If passes, collect
                matches.push({ id: doc.id, ...data });
            });

            // 4. Display results
            if (matches.length === 0) {
                resultsDiv.innerHTML = '<p>No events found matching your criteria.</p>';
                return;
            }

            // Build simple cards for each event
            resultsDiv.innerHTML = '';
            matches.forEach(ev => {
                const card = document.createElement('div');
                card.classList.add('event-card');

                // Format date/time text
                let dateText = '';
                if (ev.startDateTime && ev.startDateTime.toDate) {
                    const startDate = ev.startDateTime.toDate();
                    const endDate   = ev.endDateTime && ev.endDateTime.toDate();
                    if (endDate) {
                        // Same‐day?
                        if (
                            startDate.getFullYear() === endDate.getFullYear() &&
                            startDate.getMonth() === endDate.getMonth() &&
                            startDate.getDate() === endDate.getDate()
                        ) {
                            const dateStr   = startDate.toLocaleDateString('en-US', { dateStyle: 'long' });
                            const startTime = startDate.toLocaleTimeString('en-US', { timeStyle: 'short' });
                            const endTime   = endDate.toLocaleTimeString('en-US', { timeStyle: 'short' });
                            dateText = `${dateStr} · ${startTime} – ${endTime} (UTC)`;
                        } else {
                            const startStr = startDate.toLocaleString('en-US', {
                                dateStyle: 'long', timeStyle: 'short'
                            });
                            const endStr   = endDate.toLocaleString('en-US', {
                                dateStyle: 'long', timeStyle: 'short'
                            });
                            dateText = `${startStr} UTC – ${endStr} UTC`;
                        }
                    } else {
                        dateText = startDate.toLocaleString('en-US', {
                            dateStyle: 'long', timeStyle: 'short'
                        }) + ' UTC';
                    }
                }

                // Escape HTML (basic)
                function escapeHtml(str) {
                    return str
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;');
                }

                // Build innerHTML
                const nameEsc = escapeHtml(ev.name || '');
                const catEsc  = escapeHtml(ev.category || '');
                const placeEsc= escapeHtml(ev.place || '');
                const priceEsc= escapeHtml(ev.price || '');
                const descEsc = escapeHtml(ev.description || '');
                const contactEsc = escapeHtml(ev.contact || '');
                const linkEsc = ev.link
                    ? `<a href="${escapeHtml(ev.link)}" target="_blank">More info</a>`
                    : '';
                const tagsEsc = Array.isArray(ev.tags) && ev.tags.length
                    ? ev.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')
                    : '';

                card.innerHTML = `
          <h3>${nameEsc}</h3>
          <p><strong>Category:</strong> ${catEsc}</p>
          ${tagsEsc ? `<p><strong>Tags:</strong> ${tagsEsc}</p>` : ''}
          ${dateText ? `<p><strong>When:</strong> ${escapeHtml(dateText)}</p>` : ''}
          <p><strong>Where:</strong> ${placeEsc}</p>
          ${priceEsc ? `<p><strong>Price:</strong> ${priceEsc}</p>` : ''}
          ${linkEsc ? `<p>${linkEsc}</p>` : ''}
          ${contactEsc ? `<p><strong>Contact:</strong> ${contactEsc}</p>` : ''}
          ${ev.imageURL
                    ? `<img src="${ev.imageURL}" alt="${nameEsc}" class="event-thumb"/>`
                    : ''
                }
          ${descEsc ? `<p>${descEsc}</p>` : ''}
          <hr />
        `;
                resultsDiv.appendChild(card);
            });
        });
    }
});
