-- Efface toutes les boutiques de démonstration (articles, commandes, notes, clients suivent en cascade).
delete from fiila.shops where demo;
select count(*) as boutiques_demo_restantes from fiila.shops where demo;
