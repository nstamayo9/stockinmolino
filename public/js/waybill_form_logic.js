// public/js/waybill_form_logic.js (Content integrated into incoming_new.ejs)

// ----------------- GLOBAL VARIABLES -----------------
let allProductsData = []; // Renamed to avoid confusion with `products` local in dropdown
const uomOptions = <%- JSON.stringify(uomOptions) %>; // Passed from EJS

let _waybillIndexCounter = 0; // For dynamically added waybills
const waybillsContainer = document.getElementById("waybillsContainer");

// ----------------- HTML ESCAPE UTILITIES -----------------
function escapeHtmlAttribute(str) {
    if (typeof str !== 'string' && typeof str !== 'number') return '';
    str = String(str);
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '`': '&#x60;', '=': '&#x3D;' };
    return str.replace(/[&<>"'`=]/g, m => map[m]);
}

function escapeHtmlText(str) {
    if (typeof str !== 'string' && typeof str !== 'number') return '';
    str = String(str);
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, m => map[m]);
}

// ----------------- LOAD PRODUCTS (Corrected for Paginated Response) -----------------
async function loadProducts() {
  try {
    // Request a very high limit to get all products for dropdowns
    const res = await fetch("/products/all?limit=9999"); // Assuming this route exists in stockinmolino
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP error! status: ${res.status} - ${errorText}`);
    }
    const responseData = await res.json(); // This will be an object { products: [...], ... }
    allProductsData = responseData.products || []; // Extract the array of products
    allProductsData.sort((a, b) => a.productName.localeCompare(b.productName));
    console.log(`Loaded ${allProductsData.length} products for dropdowns.`);
  } catch (err) {
    console.error("Error loading products:", err);
    alert("Failed to load products for dropdowns. Please refresh the page.");
    allProductsData = []; // Ensure it's empty on error
  }
}

// ----------------- FIX SELECTIZE DROPDOWN POSITION -----------------
// Modified to use window.selectizeInstances for tracking all instances
window.selectizeInstances = [];

function fixSelectizeDropdown(selectizeInstance) {
  selectizeInstance.positionDropdown = function() {
    const $control = this.$control;
    const $dropdown = this.$dropdown;
    const controlRect = $control[0].getBoundingClientRect();
    $dropdown.css({
      top: controlRect.bottom + (window.scrollY || window.pageYOffset), // Use bottom of control
      left: controlRect.left + (window.scrollX || window.pageXOffset),
      width: controlRect.width,
      position: 'absolute',
      zIndex: 2147483647 // High z-index
    });
  };
  // Also fix position when dropdown opens or window scrolls/resizes
  selectizeInstance.on('dropdown_open', () => selectizeInstance.positionDropdown());
  // Add instance to global tracker
  window.selectizeInstances.push(selectizeInstance);
}

// Recalculate all dropdowns on scroll/resize
window.addEventListener('scroll', () => {
  window.selectizeInstances.forEach(instance => {
    if (instance.isOpen) { // Only reposition if dropdown is open
      instance.positionDropdown();
    }
  });
});
window.addEventListener('resize', () => {
  window.selectizeInstances.forEach(instance => {
    if (instance.isOpen) { // Only reposition if dropdown is open
      instance.positionDropdown();
    }
  });
});


// ----------------- CREATE ITEM ROW -----------------
function createItemRow(waybillIdx, itemIdx, itemData = {}) {
  const tr = document.createElement("tr");
  // Set a data attribute to easily find and update product category
  tr.setAttribute('data-item-index', itemIdx);

  const productSelectId = `waybills_${waybillIdx}_items_${itemIdx}_productName`;
  const uomSelectId = `waybills_${waybillIdx}_items_${itemIdx}_uomIncoming`;
  const categoryInputId = `waybills_${waybillIdx}_items_${itemIdx}_category`;

  tr.innerHTML = `
    <td class="border px-2 py-1">
      <select id="${productSelectId}" name="waybills[${waybillIdx}][items][${itemIdx}][productName]" class="product-select w-full p-1" required>
        <option value="">-- Select Product --</option>
      </select>
    </td>
    <td class="border px-2 py-1">
      <input type="number" name="waybills[${waybillIdx}][items][${itemIdx}][incoming]"
             value="${escapeHtmlAttribute(itemData.incoming !== undefined ? itemData.incoming : '')}"
             class="w-full p-2 border rounded h-10" min="0" required>
    </td>
    <td class="border px-2 py-1">
      <select id="${uomSelectId}" name="waybills[${waybillIdx}][items][${itemIdx}][uomIncoming]" class="uom-select-row w-full focus:ring-blue-500 focus:border-blue-500" required>
        <option value="">-- Select UOM --</option>
      </select>
    </td>
    <!-- ADDED: actualCount and remarkActual inputs -->
    <td class="border px-2 py-1">
      <input type="number" name="waybills[${waybillIdx}][items][${itemIdx}][actualCount]"
             value="${escapeHtmlAttribute(itemData.actualCount !== undefined ? itemData.actualCount : itemData.incoming !== undefined ? itemData.incoming : '')}"
             class="w-full p-2 border rounded h-10" min="0" required>
    </td>
    <td class="border px-2 py-1">
      <input type="text" name="waybills[${waybillIdx}][items][${itemIdx}][remarkActual]"
             value="${escapeHtmlAttribute(itemData.remarkActual !== undefined ? itemData.remarkActual : '')}"
             class="w-full p-2 border rounded h-10">
    </td>
    <!-- END ADDED -->
    <td class="border px-2 py-1">
      <input type="number" name="waybills[${waybillIdx}][items][${itemIdx}][conversionFactor]"
             value="${escapeHtmlAttribute(itemData.conversionFactor !== undefined ? itemData.conversionFactor : 1)}"
             class="w-full p-2 border rounded h-10" min="1" required>
    </td>
    <td class="border px-2 py-1 text-center">
      <button type="button" class="text-red-500 hover:underline remove-item-btn">Remove</button>
    </td>
    <!-- Hidden category input to store the category associated with the selected product -->
    <input type="hidden" id="${categoryInputId}" name="waybills[${waybillIdx}][items][${itemIdx}][category]" value="${escapeHtmlAttribute(itemData.category || '')}">
  `;

  // Initialize Selectize for product
  const productSelectElement = tr.querySelector(`#${productSelectId}`);
  const productOptions = allProductsData.map(p => ({
    value: p.productName,
    text: p.productName,
    category: p.category // Store category here for easy access
  }));

  const productSelectize = $(productSelectElement).selectize({
    maxItems: 1,
    valueField: 'value',
    labelField: 'text',
    searchField: ['text', 'category'],
    options: productOptions,
    create: true,
    dropdownParent: 'body',
    dropdownClass: 'selectize-dropdown-custom',
    render: {
        option: function(item, escape) {
            return `<div>
                        <span class="text-gray-900">${escape(item.text)}</span>
                        ${item.category ? `<span class="text-xs text-gray-500 ml-2">(${escape(item.category)})</span>` : ''}
                    </div>`;
        }
    },
    onChange: function(value) {
        const selectedProduct = allProductsData.find(p => p.productName === value);
        const categoryInput = document.getElementById(categoryInputId);
        if (categoryInput) {
            categoryInput.value = selectedProduct ? selectedProduct.category : '';
        }
    },
    onItemAdd: function(value) { // Ensure category is set on initial selection or creation
        const selectedProduct = allProductsData.find(p => p.productName === value);
        const categoryInput = document.getElementById(categoryInputId);
        if (categoryInput) {
            categoryInput.value = selectedProduct ? selectedProduct.category : '';
        }
    }
  })[0].selectize;
  fixSelectizeDropdown(productSelectize);

  if (itemData.productName) {
      productSelectize.setValue(itemData.productName, true); // Set initial value without triggering onChange yet
  }


  // Initialize Selectize for UOM for ITEM ROWS
  const uomSelectElement = tr.querySelector(`#${uomSelectId}`);
  const uomSelectizeRow = $(uomSelectElement).selectize({
    create: false,
    sortField: 'text',
    dropdownParent: 'body',
    dropdownClass: 'selectize-dropdown-custom',
    options: uomOptions.map(u => ({ value: u, text: u })),
    items: [itemData.uomIncoming || ''],
    onInitialize: function() {
      this.$control.css({ height: '40px', display: 'flex', alignItems: 'center', padding: '0 0.5rem', boxSizing: 'border-box', lineHeight: '1.5' });
      this.$control_input.css({ padding: '0', lineHeight: '1.5', height: 'auto', flexGrow: '1', boxSizing: 'border-box' });
      this.$control.find('.item, .item-placeholder').css({ padding: '0', lineHeight: '1.5' });
      this.$control.find('.selectize-input > span').css({ padding: '0', lineHeight: '1.5' });
    }
  })[0].selectize;
  fixSelectizeDropdown(uomSelectizeRow);

  tr.querySelector(".remove-item-btn").addEventListener("click", () => tr.remove());
  return tr;
}

// ----------------- CREATE WAYBILL BLOCK -----------------
function createWaybillBlock(data = {}, isEditMode = false) {
  const wbIndex = isEditMode ? 0 : _waybillIndexCounter++;
  const div = document.createElement("div");
  div.classList.add("waybill-card", "p-4", "border", "rounded-lg", "shadow-sm", "mb-4"); // Use waybill-card class
  div.setAttribute('data-waybill-index', wbIndex);

  const waybillDate = data.date ? new Date(data.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

  div.innerHTML = `
    <div class="flex items-center justify-between mb-4 border-b pb-2">
      <h3 class="text-lg font-semibold text-gray-800">Waybill #${wbIndex + 1}</h3>
      ${!isEditMode ? `<button type="button" class="remove-waybill-btn text-red-600 hover:text-red-800 font-bold text-xl leading-none">&times;</button>` : ''}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 items-start">
      <div>
        <label class="block font-medium mb-1 text-gray-700">Waybill No <span class="text-red-500">*</span></label>
        <input type="text" name="waybills[${wbIndex}][waybillNo]" value="${escapeHtmlAttribute(data.waybillNo || '')}"
               required class="w-full p-2 border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 h-10">
      </div>
      <div>
        <label class="block font-medium mb-1 text-gray-700">Count <span class="text-red-500">*</span></label>
        <input type="number" name="waybills[${wbIndex}][count]" value="${escapeHtmlAttribute(data.count !== undefined ? data.count : '')}"
               required class="w-full p-2 border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 h-10" min="0">
      </div>
      <div class="waybill-uom-field">
        <label class="block font-medium mb-1 text-gray-700">UOM <span class="text-red-500">*</span></label>
        <select id="waybills_${wbIndex}_uom" name="waybills[${wbIndex}][uom]" class="uom-select-waybill w-full" required>
            <option value="">-- Select UOM --</option>
        </select>
      </div>
      <div>
        <label class="block font-medium mb-1 text-gray-700">Date</label>
        <input type="date" name="waybills[${wbIndex}][date]" value="${escapeHtmlAttribute(waybillDate)}"
               class="w-full p-2 border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 h-10">
      </div>
    </div>

    <h4 class="font-medium mb-2 text-gray-700">Items:</h4>
    
    <button type="button" class="add-item-row-btn mb-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
      + Add Product
    </button>

    <div class="overflow-x-auto mb-4">
        <table class="min-w-full divide-y divide-gray-200 border border-gray-200 rounded">
            <thead class="bg-gray-100">
                <tr>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product Name</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Incoming QTY</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UOM</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actual Count</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Remark</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conv. Factor</th>
                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
            </thead>
            <tbody class="itemsBody divide-y divide-gray-200"></tbody>
        </table>
    </div>
  `;

  // Initialize waybill UOM with proper height alignment
  const uomSelectWaybillElement = div.querySelector(`#waybills_${wbIndex}_uom`);
  const uomSelectizeWaybill = $(uomSelectWaybillElement).selectize({
    create: false,
    sortField: 'text',
    dropdownParent: 'body',
    dropdownClass: 'selectize-dropdown-custom',
    options: uomOptions.map(u => ({ value: u, text: u })),
    items: [data.uom || ''],
    onInitialize: function() {
      this.$control.css({ height: '40px', display: 'flex', alignItems: 'center', padding: '0 0.5rem', boxSizing: 'border-box', lineHeight: '1.5' });
      this.$control_input.css({ padding: '0', lineHeight: '1.5', height: 'auto', flexGrow: '1', boxSizing: 'border-box' });
      this.$control.find('.item, .item-placeholder').css({ padding: '0', lineHeight: '1.5' });
      this.$control.find('.selectize-input > span').css({ padding: '0', lineHeight: '1.5' });
    }
  })[0].selectize;
  fixSelectizeDropdown(uomSelectizeWaybill);

  const itemsBody = div.querySelector(".itemsBody");
  // Initialize items for this waybill block
  if (data.items && data.items.length) {
    data.items.forEach((item, i) => itemsBody.appendChild(createItemRow(wbIndex, i, item)));
  } else {
    itemsBody.appendChild(createItemRow(wbIndex, 0)); // Add one empty item by default
  }

  div.querySelector(".add-item-row-btn").addEventListener("click", () => {
    const nextItemIndex = itemsBody.querySelectorAll("tr").length;
    itemsBody.appendChild(createItemRow(wbIndex, nextItemIndex));
  });

  if (!isEditMode) {
    const removeBtn = div.querySelector(".remove-waybill-btn");
    if (removeBtn) removeBtn.addEventListener("click", () => {
        // Before removing, destroy Selectize instances within this div
        div.querySelectorAll('.selectized').forEach(el => {
            if (el.selectize) {
                const index = window.selectizeInstances.indexOf(el.selectize);
                if (index > -1) {
                    window.selectizeInstances.splice(index, 1); // Remove from tracker
                }
                el.selectize.destroy();
            }
        });
        div.remove();
        // After removal, re-index remaining waybills and update save button
        updateWaybillIndexes();
        window.toggleSaveButton();
    });
  }

  waybillsContainer.appendChild(div);
  return div;
}

// Function to update waybill block indexes after removal
function updateWaybillIndexes() {
    document.querySelectorAll('.waybill-card').forEach((card, newWaybillIndex) => {
        card.setAttribute('data-waybill-index', newWaybillIndex);
        card.querySelector('h3').textContent = `Waybill #${newWaybillIndex + 1}`;

        card.querySelectorAll('input, select').forEach(input => {
            const currentName = input.getAttribute('name');
            if (currentName) {
                // Regex to find 'waybills[oldIndex]' and replace with 'waybills[newIndex]'
                input.setAttribute('name', currentName.replace(/waybills\[\d+\]/, `waybills[${newWaybillIndex}]`));
            }
            // Update IDs if they contain waybill index
            const currentId = input.getAttribute('id');
            if (currentId) {
                input.setAttribute('id', currentId.replace(/waybills_\d+_/, `waybills_${newWaybillIndex}_`));
            }
        });
        // Also re-index item names within each waybill block
        card.querySelectorAll('.itemsBody tr').forEach((row, newItemIndex) => {
            row.querySelectorAll('input, select').forEach(input => {
                const currentName = input.getAttribute('name');
                if (currentName) {
                    // Regex to find 'items[oldIndex]' and replace with 'items[newIndex]'
                    input.setAttribute('name', currentName.replace(/items\[\d+\]/, `items[${newItemIndex}]`));
                }
                const currentId = input.getAttribute('id');
                if (currentId) {
                    input.setAttribute('id', currentId.replace(/items_\d+_/, `items_${newItemIndex}_`));
                }
            });
        });
    });
    _waybillIndexCounter = document.querySelectorAll('.waybill-card').length;
}


// ----------------- INITIALIZE FORM -----------------
window.initializeWaybillForm = async (initialWaybillData = null, isEditMode = false) => {
  await loadProducts();

  if (isEditMode && initialWaybillData && Object.keys(initialWaybillData).length > 0) {
    createWaybillBlock(initialWaybillData, true);
  } else {
    if (waybillsContainer.children.length === 0) {
        createWaybillBlock({}, false);
    }
  }
  window.toggleSaveButton();
};

// ----------------- DOMContentLoaded (Main Logic) -----------------
document.addEventListener('DOMContentLoaded', async () => {
  const saveBtn = document.getElementById('saveWaybills');
  const addWaybillBtn = document.getElementById('addWaybill');

  window.toggleSaveButton = () => {
    saveBtn.disabled = waybillsContainer.children.length === 0;
  };

  await window.initializeWaybillForm(null, false);

  if (addWaybillBtn) {
    addWaybillBtn.addEventListener("click", () => {
        createWaybillBlock({}, false);
        window.toggleSaveButton();
    });
  }

  const observer = new MutationObserver(window.toggleSaveButton);
  observer.observe(waybillsContainer, { childList: true });


  document.getElementById('waybillForm').addEventListener('submit', (event) => {
      let isValid = true;
      let firstInvalidField = null;

      document.querySelectorAll('.waybill-card').forEach(card => {
          card.querySelectorAll('input[required], select[required]').forEach(field => {
              if (field.classList.contains('selectized')) {
                  const selectizeInstance = $(field).data('selectize');
                  if (selectizeInstance && !selectizeInstance.getValue().trim()) {
                      isValid = false;
                      $(selectizeInstance.$control).addClass('border-red-500', 'ring-red-500'); // Add classes
                      if (!firstInvalidField) firstInvalidField = selectizeInstance.$control;
                  } else {
                      $(selectizeInstance.$control).removeClass('border-red-500', 'ring-red-500'); // Remove classes
                  }
              } else if (!field.value.trim()) {
                  isValid = false;
                  field.classList.add('border-red-500', 'ring-red-500');
                  if (!firstInvalidField) firstInvalidField = field;
              } else {
                  field.classList.remove('border-red-500', 'ring-red-500');
              }
          });
      });

      if (!isValid) {
          event.preventDefault();
          alert('Please fill in all required fields.');
          if (firstInvalidField) {
              firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
              const selectizeInstance = $(firstInvalidField).data('selectize');
              if (selectizeInstance && !selectizeInstance.isOpen) {
                  selectizeInstance.open();
              }
          }
      }
  });
});