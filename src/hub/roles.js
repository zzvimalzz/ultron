'use strict';

const ROLES = [
  { id: 'code', label: 'Code' }, { id: 'ui', label: 'UI/UX' }, { id: 'qa', label: 'QA' },
  { id: 'testing', label: 'Testing' }, { id: 'research', label: 'Research' }, { id: 'review', label: 'Review' },
  { id: 'images', label: 'Images' }, { id: 'svg', label: 'SVG' },
];

const DEFAULT_ROLES = {
  claude: ['code', 'ui', 'qa', 'testing', 'research', 'review', 'svg'],
  chatgpt: ['code', 'images', 'research', 'review'],
};

module.exports = { ROLES, DEFAULT_ROLES };
