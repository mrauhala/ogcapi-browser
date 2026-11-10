import { useEffect } from 'react';
import { adjacentCollection } from '../collections/openingCollection';
import { useCollection } from '../contexts/CollectionContext';
import { useOpenCollection } from '../contexts/OpenCollectionContext';
import { takesItsOwnKeys } from '../utils/ownKeys';

// PageUp and PageDown go through the collections, or through the API's list while that's showing
export function useCollectionKeyboardNav(listShowing: boolean) {
  const { collections, selectedCollection } = useCollection();
  const { openCollection } = useOpenCollection();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return;

      // Not from a field or an open list, where PageUp and PageDown are the list's own
      if (takesItsOwnKeys(e.target)) return;

      if (listShowing) {
        const list = document.getElementById('api-pane');
        if (!list) return;
        e.preventDefault();
        list.scrollBy({ top: (e.key === 'PageDown' ? 0.9 : -0.9) * list.clientHeight });
        return;
      }

      const target = adjacentCollection(collections, selectedCollection, e.key === 'PageDown' ? 1 : -1);
      if (!target) return;
      e.preventDefault();
      openCollection(target);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [listShowing, collections, selectedCollection, openCollection]);
}
