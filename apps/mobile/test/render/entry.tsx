import * as React from 'react';
import { createRoot } from 'react-dom/client';
import CirclesTab from '../../app/(tabs)/circles';
import NewCircle from '../../app/circle/new';
import CircleDetail from '../../app/circle/[id]';
import Teams from '../../app/teams';
import NewRoulette from '../../app/roulette/new';
import NewDoubleDate from '../../app/double-date/new';
import SafetyHub from '../../app/safety/index';
import Trusted from '../../app/safety/trusted';
import Wing from '../../app/safety/wing';
import Together from '../../app/safety/together';
import Privacy from '../../app/safety/privacy';
import Blocked from '../../app/safety/blocked';
import YourData from '../../app/safety/data';
import Notifications from '../../app/notifications';
import Game from '../../app/game/[id]';
import Restricted from '../../app/account-restricted';

const screens: Record<string, React.ComponentType> = { circles: CirclesTab, 'circle-new': NewCircle, circle: CircleDetail, teams: Teams, 'roulette-new': NewRoulette, 'double-date-new': NewDoubleDate,
  safety: SafetyHub, trusted: Trusted, wing: Wing, together: Together, privacy: Privacy, blocked: Blocked, data: YourData, notifications: Notifications, game: Game, restricted: Restricted };
(window as any).__mount = (name: string) => { const C = screens[name]!; createRoot(document.getElementById('root')!).render(<C />); };
