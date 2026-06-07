# UI Mapper and Selector Strategy

## 1. Goal

The UI mapper builds a structured understanding of a SaaS app's rendered interface.

It extracts:

1. Pages.
2. Interactive elements.
3. Labels.
4. Accessibility metadata.
5. Descriptions.
6. Stable selectors.
7. Fallback selectors.
8. Selector quality.
9. Searchable text for Moss.

The mapper is critical because the workflow engine must reference exact UI elements, not vague visual descriptions.

## 2. MVP Mapping Approach

Use a runtime browser scan with Playwright.

Why:

1. It captures rendered UI.
2. It sees real labels and accessibility names.
3. It handles dynamic React output.
4. It is easier to debug for the hackathon.
5. It maps what users actually see.

Static code scanning is deferred.

## 3. Route Configuration

The mapper should accept routes:

```json
{
  "appId": "app_example_app",
  "baseUrl": "http://localhost:3000",
  "routes": [
    "/login",
    "/dashboard",
    "/customers",
    "/customers/new",
    "/settings/team"
  ]
}
```

For MVP, routes can be manually configured.

Later, routes can be discovered automatically.

## 4. Extraction Scope

Extract visible interactive elements:

1. Buttons.
2. Links.
3. Inputs.
4. Textareas.
5. Selects.
6. Checkboxes.
7. Radios.
8. Tabs.
9. Menu items.
10. Dialog buttons.
11. Form submit buttons.
12. Table row actions.

Also extract containers where useful:

1. Forms.
2. Modals/dialogs.
3. Tables/lists.
4. Navigation sections.

## 5. Element Metadata

For each element, extract:

```text
Page name
Route
URL
Element type
Tag name
Role
Visible label
Accessible name
Placeholder
ARIA label
Input name
Input type
Button text
Link href
Nearby text
Parent section
Form name
Modal/dialog context
Table/list context
Stable selector
Fallback selectors
Bounding box
Element description
Tags
Selector quality
Selector warnings
```

## 6. Selector Generation

## 6.1 Selector Priority

```text
1. data-ai-id
2. data-testid
3. role + accessible name
4. aria-label
5. label/input association
6. name
7. id
8. placeholder
9. visible text
10. CSS selector
11. DOM path as last resort
```

## 6.2 Strong Selectors

Strong selectors are stable and developer-controlled.

Examples:

```html
<button data-ai-id="customers.new_customer_button">New Customer</button>
```

```html
<input data-testid="customers.customer_email_input" />
```

Selector:

```text
[data-ai-id='customers.new_customer_button']
```

Quality:

```text
strong
```

## 6.3 Medium Selectors

Medium selectors are based on accessibility or semantic attributes.

Examples:

```text
role=button + accessible name "New Customer"
aria-label="New Customer"
label text "Email"
input name="email"
id="email"
```

Quality:

```text
medium
```

## 6.4 Weak Selectors

Weak selectors are brittle.

Examples:

```text
button:nth-child(3)
div > div > button
text-only selector with duplicate labels
DOM path
```

Quality:

```text
weak
```

## 7. Selector Quality Scoring

Suggested scoring:

| Signal | Points |
|---|---:|
| Has `data-ai-id` | +100 |
| Has `data-testid` | +90 |
| Unique role + accessible name | +75 |
| Unique aria-label | +70 |
| Label-associated input | +65 |
| Unique name | +55 |
| Unique id | +50 |
| Unique placeholder | +40 |
| Unique visible text | +35 |
| CSS selector | +20 |
| DOM path | +5 |
| Duplicate selector | -40 |
| Dynamic/generated id | -30 |
| nth-child-heavy selector | -30 |
| Missing accessible name | -10 |

Map scores:

```text
80+    strong
45-79  medium
0-44   weak
```

## 8. Stable Attribute Upgrade Recommendations

For weak or medium important elements, recommend adding `data-ai-id`.

Example recommendation:

```json
{
  "elementId": "customers.new_customer_button",
  "currentSelector": "button:nth-child(3)",
  "selectorQuality": "weak",
  "recommendation": {
    "attribute": "data-ai-id",
    "value": "customers.new_customer_button",
    "example": "<Button data-ai-id=\"customers.new_customer_button\">New Customer</Button>"
  }
}
```

## 9. How Existing Apps Adopt Attributes

## 9.1 Manual Addition

Developer adds attributes to important elements.

```tsx
<Button data-ai-id="customers.new_customer_button">
  New Customer
</Button>
```

## 9.2 Shared Component Wrapping

A mature app may expose an `aiId` prop.

```tsx
<Button aiId="customers.new_customer_button">
  New Customer
</Button>
```

Component renders:

```tsx
<button data-ai-id={props.aiId}>
  {children}
</button>
```

## 9.3 CLI Suggestions

The local mapper can output recommendations.

```text
Weak selector found:
Customers page → New Customer button

Suggested attribute:
data-ai-id="customers.new_customer_button"
```

## 9.4 Codemod Later

Not required for MVP.

Later, generate code patches or PRs.

## 10. Element ID Generation

Element IDs should be stable and readable.

Recommended format:

```text
{page_slug}.{semantic_name}_{element_type}
```

Examples:

```text
customers.new_customer_button
customers.customer_name_input
customers.customer_email_input
customers.save_customer_button
settings.invite_teammate_button
settings.invite_email_input
settings.send_invite_button
```

If page has repeated elements, include context:

```text
customers.table.edit_customer_button
customers.table.delete_customer_button
```

## 11. Description Generation

## 11.1 Hybrid Method

Use:

1. Rule-based description first.
2. LLM enhancement if unclear.
3. Human edit in console.
4. Store approved description.
5. Index in Moss.

## 11.2 Rule-Based Templates

Button:

```text
{label} button on the {page} page.
```

Improved button with context:

```text
Opens the {target_object} creation form from the {page} page.
```

Input:

```text
Input field for {label} on the {page} page.
```

Select:

```text
Dropdown for selecting {label} on the {page} page.
```

Navigation link:

```text
Navigates to the {label} section.
```

## 11.3 LLM Description Prompt

Use a small Qwen model only when needed.

Prompt:

```text
You are generating concise descriptions for SaaS UI elements.

Given this UI element metadata, write one short sentence describing what the element does.
Do not invent functionality.
Use the page, label, role, nearby text, and parent section.
Return only the description.

Metadata:
{metadata_json}
```

Bad output:

```text
This button is amazing and helps users manage everything.
```

Good output:

```text
Opens the customer creation form from the Customers page.
```

## 12. Moss Indexing

## 12.1 Do Not Store Only Embeddings

Store full structured records in local DB.

Index a searchable copy in Moss.

## 12.2 Searchable Text Template

```text
Page: {pageName}
Route: {route}
Element type: {elementType}
Role: {role}
Label: {label}
Accessible name: {accessibleName}
Description: {description}
Nearby text: {nearbyText}
Parent section: {parentSection}
Tags: {tags}
```

## 12.3 Metadata for Moss

```json
{
  "kind": "ui_element",
  "appId": "app_example_app",
  "elementId": "customers.new_customer_button",
  "route": "/customers",
  "pageName": "Customers",
  "elementType": "button",
  "selectorQuality": "strong"
}
```

## 13. Matching Video Actions to Elements

Given Qwen action:

```json
{
  "page": "Customers",
  "action": "click",
  "observedElement": "Create Customer button",
  "visualContext": "Top right of customer list"
}
```

Build Moss query:

```text
click create customer button on Customers page near top right customer list
```

Filters:

```json
{
  "appId": "app_example_app",
  "route": "/customers",
  "elementType": "button"
}
```

Return:

```json
{
  "elementId": "customers.new_customer_button",
  "score": 0.91
}
```

If score is low:

1. Mark step as unmatched.
2. Let human reviewer choose element.

## 14. Mapper Implementation Pseudocode

```ts
async function scanApp(config: ScanConfig): Promise<UIMapVersion> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const mapVersion = await db.createUIMapVersion(config.appId);

  for (const route of config.routes) {
    try {
      await page.goto(config.baseUrl + route);
      await page.waitForLoadState("networkidle");

      const pageRecord = await extractPageRecord(page, route);
      const elements = await extractInteractiveElements(page);

      for (const raw of elements) {
        const selectorInfo = generateSelector(raw);
        const description = await generateDescription(raw, selectorInfo);
        const quality = scoreSelector(selectorInfo);

        const record = buildElementRecord({
          raw,
          selectorInfo,
          description,
          quality
        });

        await db.saveElement(record);
        await moss.indexElement(toMossRecord(record));
      }
    } catch (error) {
      await db.markPageFailed(route, error);
    }
  }

  await browser.close();
  return db.completeUIMapVersion(mapVersion.id);
}
```

## 15. MVP Mapper Acceptance Criteria

1. Can scan example app routes.
2. Extracts at least buttons and inputs.
3. Creates element descriptions.
4. Creates stable selector when `data-ai-id` exists.
5. Creates fallback selector when stable selector does not exist.
6. Scores selector quality.
7. Shows weak selector warnings in console.
8. Indexes searchable element records in Moss.
9. Stores full UI map in local DB.
