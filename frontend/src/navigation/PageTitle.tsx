import { useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';

export function PageTitle() {
  const [location] = useLocation();
  const search = useSearch();

  useEffect(() => {
    let title = 'PreciSign';
    const path = (typeof window !== 'undefined' ? window.location.pathname : location).replace(/\/+$/, '') || '/';
    const searchStr = typeof window !== 'undefined' ? window.location.search : search;

    if (path === '/' || path === '/dashboard') {
      title = 'PreciSign | Overview';
    } else if (path === '/forms') {
      title = 'PreciSign | Forms Library';
    } else if (path === '/archive') {
      title = 'PreciSign | Archive & Register';
    } else if (path === '/settings/profile' || path === '/settings') {
      title = 'PreciSign | User Profile';
    } else if (path === '/settings/signing-routes') {
      title = 'PreciSign | Signing Routes';
    } else if (path === '/settings/users') {
      title = 'PreciSign | User Directory';
    } else if (path === '/settings/branding') {
      title = 'PreciSign | Company Branding';
    } else if (path === '/rnd') {
      title = 'PreciSign | New R&D Initiative';
    } else if (path.startsWith('/forms/')) {
      const match = path.match(/^\/forms\/([^/]+)\/new$/);
      if (match) {
        const slug = match[1];
        const names: Record<string, string> = {
          'administrative-payment': 'Administrative & Payment Request',
          'admin-payment': 'Administrative & Payment Request',
          'it-request': 'IT Request',
          'it': 'IT Request',
          'cash-voucher': 'Cash Voucher',
          'expense-claim': 'Expense Claim',
          'rnd': 'R&D Initiative',
          'rnd-initiative': 'R&D Initiative',
          'admin-work': 'Admin Work Request',
        };
        title = `PreciSign | New ${names[slug] || 'Request'}`;
      } else {
        title = 'PreciSign | New Request';
      }
    } else if (path.startsWith('/requests/')) {
      const match = path.match(/^\/requests\/([^/]+)$/);
      if (match) {
        try {
          title = `PreciSign | Request ${decodeURIComponent(match[1])}`;
        } catch {
          title = `PreciSign | Request ${match[1]}`;
        }
      } else {
        title = 'PreciSign | Review Request';
      }
    } else if (path === '/requests') {
      const params = new URLSearchParams(searchStr);
      const filter = params.get('filter');
      const filterNames: Record<string, string> = {
        pending: 'Needs My Action',
        my: 'My PreciRoutes',
        all: 'All Routes',
        approved: 'Approved Routes',
      };
      title = filter && filterNames[filter] ? `PreciSign | ${filterNames[filter]}` : 'PreciSign | Requests';
    } else {
      title = 'PreciSign | Page Not Found';
    }

    document.title = title;
  }, [location, search]);

  return null;
}
