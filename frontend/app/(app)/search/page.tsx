import { Suspense } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { SearchResults } from '@/components/search/SearchResults';

/**
 * The route.
 *
 * `useSearchParams` opts a route out of static rendering, and Next requires the
 * component calling it to sit inside a Suspense boundary or the whole route
 * becomes dynamic with no fallback. The skeleton is the shape the page occupies,
 * so the layout does not jump when results arrive.
 */
export default function SearchPage() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchResults />
    </Suspense>
  );
}

function SearchSkeleton() {
  return (
    <div className="search-page">
      <div className="search-page-bar">
        <SearchIcon size={19} />
        <span>Search the workspace</span>
      </div>
      <p className="search-count">Searching…</p>
    </div>
  );
}
