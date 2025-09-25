const categories = {
    ActiveRecreation: "Активный отдых",
    Art: "Искусство",
    Boardgames: "Настольные игры",
    Children: "Для детей",
    Cinema: "Кино",
    Esoterics: "Эзотерика",
    Market: "Ярмарки",
    Museum: "Музеи и выставки",
    Music: "Музыка",
    Other: "Прочее",
    Party: "Вечеринка",
    Psychology: "Психология",
    Quiz: "Викторина",
    Sport: "Спорт",
    Theatre: "Театр",
    Travel: "Путешествия"
};

window.categories = categories;

const categorySelect = document.getElementById('category');
categorySelect.required = true;
categorySelect.name = 'category';
categorySelect.setAttribute('data-label', 'Категория');

// placeholder
const placeholder = document.createElement('option');
placeholder.value = "";
placeholder.textContent = "Выберите категорию";
placeholder.disabled = true;
placeholder.selected = true;
categorySelect.appendChild(placeholder);



categorySelect.setAttribute('data-label', 'Категория');

// fill options
Object.entries(categories).forEach(([id, name]) => {
    const option = document.createElement('option');
    option.value = id;       // в БД уйдёт ключ
    option.textContent = name; // на экране покажется русское название
    categorySelect.appendChild(option);
});

categorySelect.value = '';

