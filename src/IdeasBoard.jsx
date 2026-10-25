import { useState } from 'react';
import { ChevronDown, Columns3, LayoutGrid, MoreHorizontal, Plus, Search, Tag } from 'lucide-react';
import { Popover } from './Popover.jsx';

const defaultStages = ['Unassigned', 'To Do', 'In Progress', 'Done'];

export function IdeasBoard({ ideas, setIdeas, stages = defaultStages, tags = [], view, setView, onNew, onNewStage, onNewTag, onEdit, onActions }) {
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const shown = ideas.filter(item => {
    const matchesText = `${item.title} ${item.body || ''}`.toLowerCase().includes(query.toLowerCase());
    const matchesTags = !selectedTags.length || selectedTags.some(tag => Array.isArray(item.tags) && item.tags.includes(tag));
    return matchesText && matchesTags;
  });
  const move = (id, stage) => setIdeas(current => current.map(item => item.id === id ? { ...item, stage } : item));
  const card = item => <article className={`pw-idea-card pw-editable-idea${item.id === 'starter-web-inspiration' ? ' has-art' : ''}`} key={item.id} draggable onDragStart={event => event.dataTransfer.setData('text/postly-idea', item.id)}>
    {item.id === 'starter-web-inspiration' && <img className="pw-idea-art" src="/assets/postly-ideas-extension.png" alt="Postly interface preview showing Create Post and Save to Ideas actions"/>}
    <button className="pw-idea-title" onClick={() => onEdit(item)}>{item.title}</button>
    {item.body && <p>{item.body}</p>}
    <footer>
      <select aria-label={`Status for ${item.title}`} value={item.stage || 'Unassigned'} onChange={event => move(item.id, event.target.value)}>{stages.map(stage => <option key={stage}>{stage}</option>)}</select>
      <button aria-label={`Idea actions for ${item.title}`} onClick={() => onActions(item)}><MoreHorizontal size={17}/></button>
    </footer>
  </article>;
  const pickView = value => { setView(value); history.replaceState({}, '', `/create/ideas?view=${value.toLowerCase()}`); };

  return <>
    <div className="pw-toolbar pw-ideas-toolbar">
      <Popover label="Search ideas" className="pw-social-filter-anchor" panelClassName="pw-ideas-search-panel" align="left" buttonClassName="pw-idea-filter-button pw-idea-search-button" trigger={<Search size={16}/> }>
        <label className="pw-post-search"><Search size={15}/><input aria-label="Search ideas" placeholder="Search ideas" value={query} onChange={event => setQuery(event.target.value)}/></label>
      </Popover>
      <span className="pw-toolbar-spacer"/>
      <Popover label="Tags" className="pw-social-filter-anchor" panelClassName="pw-ideas-tag-panel" buttonClassName="pw-idea-filter-button" trigger={<><Tag size={15}/>Tags<ChevronDown size={14}/></>}>
        {close => <>
          <strong>Filter by tags</strong>
          {tags.length ? tags.map(tag => <label key={tag}><input type="checkbox" checked={selectedTags.includes(tag)} onChange={event => setSelectedTags(current => event.target.checked ? [...current, tag] : current.filter(value => value !== tag))}/>{tag}</label>) : <p className="pw-menu-empty">No tags yet. Create one to organize ideas.</p>}
          <button onClick={onNewTag}>Create tag</button>
          {selectedTags.length > 0 && <button onClick={() => setSelectedTags([])}>Clear selection</button>}
          <button onClick={close}>Done</button>
        </>}
      </Popover>
      <div className="pw-view-toggle">
        <button aria-label="Board view" className={view === 'Board' ? 'selected' : ''} onClick={() => pickView('Board')}><Columns3 size={16}/><span>Board</span></button>
        <button aria-label="Gallery view" className={view === 'Gallery' ? 'selected' : ''} onClick={() => pickView('Gallery')}><LayoutGrid size={16}/><span>Gallery</span></button>
      </div>
    </div>
    <div className={`pw-ideas-grid ${view.toLowerCase()}`}>
      {(view === 'Gallery' ? ['All Ideas'] : stages).map(stage => <section key={stage} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/postly-idea'); if (id && stage !== 'All Ideas') move(id, stage); }}>
        <h3>{stage}<small>{stage === 'All Ideas' ? shown.length : shown.filter(item => (item.stage || 'Unassigned') === stage).length}</small><button aria-label={`New idea in ${stage}`} onClick={() => onNew(stage === 'All Ideas' ? 'Unassigned' : stage)}><Plus size={15}/></button></h3>
        {shown.filter(item => stage === 'All Ideas' || (item.stage || 'Unassigned') === stage).map(card)}
        <button className="pw-add-idea" onClick={() => onNew(stage === 'All Ideas' ? 'Unassigned' : stage)}><Plus size={15}/> New Idea</button>
      </section>)}
      {view === 'Board' && <button className="pw-ideas-new-stage" aria-label="Add idea column" onClick={onNewStage}><Plus size={16}/>New</button>}
    </div>
    {!shown.length && (query || selectedTags.length > 0) && <p className="pw-muted">{query ? `No ideas match “${query}”` : 'No ideas match the selected tags.'} Try another filter.</p>}
  </>;
}
